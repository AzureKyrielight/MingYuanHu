import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '../database';
import { loadLlmConfig } from '../credentials';
import type {
  WebSearchEntry,
  WebSearchEntrySummary,
  WebSearchKeySource,
} from '../../shared/capabilities';
import { readDisabledTools, setBuiltinCapabilities } from './tools';
import { searchDeepSeek } from './deepseek';
import { stripTags } from './html-text';

// 搜索服务配置（设置 › 内置能力 › 网络）：可存多条（同类型可重复，供多账号复用额度），
// 聊天输入框左下角选择当前使用哪一条；应用不内置搜索服务。
const CONFIG_KEY = 'web-search-api';
const REQUEST_TIMEOUT_MS = 15000;
// 4 类服务各留多账号余量且列表一屏可浏览；再大主要防配置堆积。
const ENTRY_LIMIT = 16;
const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_CACHE_LIMIT = 32;
const SEARCH_SNIPPET_LIMIT = 500;
const SEARCH_TITLE_LIMIT = 200;

type SearchOptions = { domains?: string[]; excludeDomains?: string[]; refresh?: boolean };
type SearchResponse = {
  query: string;
  provider: string;
  results: WebSearchResult[];
  fallback?: boolean;
  cacheHit: boolean;
  fetchedAt: number;
  latencyMs?: number;
};
const searchCache = new Map<string, { response: SearchResponse; expiresAt: number }>();
const searchInflight = new Map<string, Promise<SearchResponse>>();

// 请求头键限 HTTP token 字符；条数封顶防滥用。
const headerKeySchema = z.string().regex(/^[\w!#$%&'*+\-.^`|~]{1,128}$/);
const headersSchema = z
  .record(headerKeySchema, z.string().min(1).max(2048))
  .refine((headers) => Object.keys(headers).length <= 32, '自定义请求头最多 32 条');

const nameSchema = z.string().trim().min(1).max(64);
const uuid = z.string().uuid();

export const webSearchEntrySchema = z.discriminatedUnion('provider', [
  z
    .object({
      id: uuid,
      name: nameSchema,
      provider: z.literal('brave'),
      apiKey: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      id: uuid,
      name: nameSchema,
      provider: z.literal('google'),
      apiKey: z.string().trim().min(1).max(256),
      cx: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      id: uuid,
      name: nameSchema,
      provider: z.literal('custom'),
      url: z.string().url().max(2048),
      headers: headersSchema.optional(),
    })
    .strict(),
  z
    .object({
      id: uuid,
      name: nameSchema,
      provider: z.literal('deepseek'),
      apiKey: z.string().trim().min(1).max(256),
      useForFetch: z.boolean(),
    })
    .strict(),
]);

/** 保存入参：id 省略表示新建。 */
export const webSearchEntryInputSchema = z.discriminatedUnion('provider', [
  z
    .object({
      id: uuid.optional(),
      name: nameSchema,
      provider: z.literal('brave'),
      apiKey: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      id: uuid.optional(),
      name: nameSchema,
      provider: z.literal('google'),
      apiKey: z.string().trim().min(1).max(256),
      cx: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      id: uuid.optional(),
      name: nameSchema,
      provider: z.literal('custom'),
      url: z.string().url().max(2048),
      headers: headersSchema.optional(),
    })
    .strict(),
  z
    .object({
      id: uuid.optional(),
      name: nameSchema,
      provider: z.literal('deepseek'),
      apiKey: z.string().trim().min(1).max(256),
      useForFetch: z.boolean(),
    })
    .strict(),
]);

const registrySchema = z
  .object({
    providers: z.array(webSearchEntrySchema).max(ENTRY_LIMIT),
    selectedId: uuid.nullable(),
  })
  .strict();

interface Registry {
  providers: WebSearchEntry[];
  selectedId: string | null;
}

function readRegistry(): Registry {
  const row = getDatabase()
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(CONFIG_KEY) as { value: string } | undefined;
  if (!row) return { providers: [], selectedId: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return { providers: [], selectedId: null };
  }
  const current = registrySchema.safeParse(parsed);
  return current.success ? current.data : { providers: [], selectedId: null };
}

function writeRegistry(registry: Registry): void {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(CONFIG_KEY, JSON.stringify(registrySchema.parse(registry)));
}

export function listWebSearchEntries(): WebSearchEntry[] {
  return readRegistry().providers;
}

/** 当前选用的条目（聊天侧选择器的记录）；null = 未选或无配置。 */
export function readWebSearchConfig(): WebSearchEntry | null {
  const { providers, selectedId } = readRegistry();
  return providers.find(({ id }) => id === selectedId) ?? null;
}

/** 新建或更新一条配置；新建即选中并启用 web_search（填完就是要用），更新不改选中。返回最新列表。 */
export function saveWebSearchEntry(
  input: z.infer<typeof webSearchEntryInputSchema>,
): WebSearchEntry[] {
  const registry = readRegistry();
  const exists = input.id != null && registry.providers.some(({ id }) => id === input.id);
  // 幽灵 id（别处已删除的草稿）按新建追加会静默复活条目，明确报错让用户重建。
  if (input.id != null && !exists) throw new Error('搜索服务配置不存在，可能已被删除');
  if (!exists && registry.providers.length >= ENTRY_LIMIT)
    throw new Error(`搜索服务配置最多 ${ENTRY_LIMIT} 条，请先删除部分配置`);
  const saved = { ...input, id: input.id ?? randomUUID() } as WebSearchEntry;
  const providers = exists
    ? registry.providers.map((item) => (item.id === saved.id ? saved : item))
    : [...registry.providers, saved];
  writeRegistry({ providers, selectedId: exists ? registry.selectedId : saved.id });
  if (!exists) setBuiltinCapabilities(['web_search'], true);
  return providers;
}

/** 删除一条配置；删的是选中项时回落到剩余第一条；删空即关闭搜索，停用 web_search。 */
export function removeWebSearchEntry(id: string): WebSearchEntry[] {
  const registry = readRegistry();
  const providers = registry.providers.filter((item) => item.id !== id);
  const selectedId = registry.selectedId === id ? (providers[0]?.id ?? null) : registry.selectedId;
  writeRegistry({ providers, selectedId });
  if (selectedId === null) setBuiltinCapabilities(['web_search'], false);
  return providers;
}

/** 聊天侧选择器的数据：脱敏条目（不含密钥与自定义请求头）与当前选中。 */
export function listWebSearchOptions(): {
  entries: WebSearchEntrySummary[];
  selectedId: string | null;
} {
  const { providers, selectedId } = readRegistry();
  return {
    entries: providers.map(({ id, name, provider }) => ({ id, name, provider })),
    selectedId:
      !readDisabledTools().has('web_search') && providers.some(({ id }) => id === selectedId)
        ? selectedId
        : null,
  };
}

/** 聊天侧选择当前使用哪条配置；选择即视为要用搜索，顺带确保 web_search 工具开启；
 *  null = 关闭联网搜索，清空选中并关掉 web_search（web_fetch 仍走本地抓取）。 */
export function selectWebSearchEntry(id: string | null): void {
  if (id === null) {
    writeRegistry({ ...readRegistry(), selectedId: null });
    setBuiltinCapabilities(['web_search'], false);
    return;
  }
  const registry = readRegistry();
  if (!registry.providers.some((item) => item.id === id))
    throw new Error('搜索服务配置不存在，可能已被删除');
  writeRegistry({ ...registry, selectedId: id });
  setBuiltinCapabilities(['web_search'], true);
}

/** DeepSeek 官方端点判定：只认 api.deepseek.com，中转或自建网关一律不算。 */
function isDeepSeekEndpoint(baseUrl: string): boolean {
  try {
    return /(^|\.)api\.deepseek\.com$/i.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

/** 可导入密钥的 DeepSeek 模型供应商（不含密钥）：启用的排最前。 */
export function listWebSearchKeySources(): WebSearchKeySource[] {
  return loadLlmConfig()
    .providers.filter((provider) => provider.apiKey && isDeepSeekEndpoint(provider.baseUrl))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled))
    .map(({ id, name }) => ({ id, name }));
}

/** 把指定 DeepSeek 模型供应商的密钥读给搜索表单预填（不落库，保存由表单决定）；
 *  导入的是静态副本，供应商此后换 Key 不会跟随，需重新导入。
 *  供应商不存在、未配置密钥或不是官方端点时返回 null。 */
export function readWebSearchKey(providerId: string): string | null {
  const provider = loadLlmConfig().providers.find(({ id }) => id === providerId);
  return provider?.apiKey && isDeepSeekEndpoint(provider.baseUrl) ? provider.apiKey : null;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function searchError(status: number): Error {
  if (status === 401 || status === 403)
    return new Error(`搜索服务认证失败（HTTP ${status}），请检查 API Key 或端点配置`);
  return new Error(`搜索失败（HTTP ${status}）`);
}

const compact = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

// Brave 固定走为大模型设计的 LLM Context 端点：grounding.generic（普通网页）
// 与 map/poi（本地召回）同构，均为 { url, title, snippets[] }，snippets 是
// 从页面抽取的内容片段而非搜索摘要。
async function searchBrave(
  query: string,
  count: number,
  freshness: string | undefined,
  apiKey: string,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(count) });
  if (freshness) params.set('freshness', freshness);
  const response = await fetch(`https://api.search.brave.com/res/v1/llm/context?${params}`, {
    headers: { accept: 'application/json', 'x-subscription-token': apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw searchError(response.status);
  const payload = (await response.json()) as {
    grounding?: {
      generic?: { url?: string | null; title?: string | null; snippets?: string[] }[];
      map?: { url?: string | null; title?: string | null; snippets?: string[] }[];
      poi?: { url?: string | null; title?: string | null; snippets?: string[] } | null;
    };
  };
  const groups = [
    ...(payload.grounding?.generic ?? []),
    ...(payload.grounding?.map ?? []),
    ...(payload.grounding?.poi ? [payload.grounding.poi] : []),
  ];
  return groups.flatMap((item) =>
    item.url
      ? [
          {
            url: item.url,
            title: compact(item.title) || item.url,
            snippet: compact((item.snippets ?? []).join(' ')),
          },
        ]
      : [],
  );
}

async function searchGoogle(
  query: string,
  count: number,
  apiKey: string,
  cx: string,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({ key: apiKey, cx, q: query, num: String(count) });
  const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw searchError(response.status);
  const payload = (await response.json()) as {
    items?: { title?: string | null; link?: string | null; snippet?: string | null }[];
  };
  return (payload.items ?? []).flatMap((item) =>
    item.link
      ? [
          {
            url: item.link,
            title: compact(item.title) || item.link,
            snippet: compact(item.snippet),
          },
        ]
      : [],
  );
}

// 自定义端点：SearXNG 兼容 JSON（{ results: [{ title, url, content }] }）；
// 注册的自定义请求头随请求发送（适配用户自备的鉴权/加密策略），可覆盖默认 accept。
async function searchCustomEndpoint(
  query: string,
  endpoint: string,
  headers: Record<string, string> | undefined,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({ q: query, format: 'json' });
  const response = await fetch(`${endpoint}?${params}`, {
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw searchError(response.status);
  const payload = (await response.json()) as {
    results?: { url?: string | null; title?: string | null; content?: string | null }[];
    // SearXNG 把无响应引擎序列化为 [引擎名, 错误文案] 元组的数组。
    unresponsive_engines?: (string | [string, string])[];
  };
  const results = (payload.results ?? []).flatMap((item) =>
    item.url
      ? [{ url: item.url, title: compact(item.title) || item.url, snippet: compact(item.content) }]
      : [],
  );
  if (results.length === 0 && (payload.unresponsive_engines?.length ?? 0) > 0) {
    const engines = payload
      .unresponsive_engines!.map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      .filter(Boolean);
    throw new Error(`搜索服务全部引擎无响应（${engines.join('、')}），请检查实例配置`);
  }
  return results;
}

// 免密钥回退用的桌面 Chrome UA：必应会对明显的脚本 UA 返回精简版结果页。
const FALLBACK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// 必应的时间过滤代码：日 / 周 / 月 / 年。
const BING_FRESHNESS: Record<string, string> = {
  pd: 'ez1',
  day: 'ez1',
  pw: 'ez2',
  week: 'ez2',
  pm: 'ez3',
  month: 'ez3',
  py: 'ez5',
  year: 'ez5',
};

/** 解析必应结果页：结果条目是 `<li class="b_algo">`，标题在其中的 `<h2><a href>`，
 *  摘要取 `b_caption` 里的第一个 `<p>`。 */
export function parseBingResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const block of html.split('<li class="b_algo"').slice(1)) {
    const link = /<h2[^>]*>\s*<a[^>]*\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = stripTags(link[1] ?? '');
    if (!/^https?:\/\//i.test(url)) continue;
    const snippet =
      /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block) ??
      /<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    results.push({
      url,
      title: stripTags(link[2] ?? '') || url,
      snippet: snippet ? stripTags(snippet[1] ?? '') : '',
    });
  }
  return results;
}

/** 免密钥搜索：抓必应网页版并解析。没配搜索服务时自动使用，作为「能搜到东西」的保底，
 *  配置了 Brave / Google / DeepSeek / 自定义端点时不会被使用。 */
async function searchBingFallback(
  query: string,
  count: number,
  freshness: string | undefined,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(20, Math.max(count * 2, 10))),
  });
  const filter = freshness ? BING_FRESHNESS[freshness.toLowerCase()] : undefined;
  if (filter) params.set('filters', `ex1:"${filter}"`);
  const response = await fetch(`https://cn.bing.com/search?${params}`, {
    headers: {
      'user-agent': FALLBACK_UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw searchError(response.status);
  const results = parseBingResults(await response.text());
  if (results.length === 0)
    throw new Error(
      '联网搜索暂不可用（必应结果页解析为空，可能被限流）；可稍后重试，或在 设置 › 内置能力 的「网络」分组中配置搜索服务',
    );
  return results;
}

/** 联网搜索工具：优先用聊天侧选中的配置；一条都没配时回退到必应网页版（免密钥），
 *  保证新用户第一轮就能联网，而不是被报错拦下。 */
function normalizeDomains(values: string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? []).map((value) => value.trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean),
    ),
  ].sort();
}

function hostMatches(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function compactResults(
  results: WebSearchResult[],
  count: number,
  options: SearchOptions,
): WebSearchResult[] {
  const domains = normalizeDomains(options.domains);
  const excluded = normalizeDomains(options.excludeDomains);
  const seen = new Set<string>();
  return results
    .filter((result) => {
      if (!/^https?:\/\//i.test(result.url) || seen.has(result.url)) return false;
      if (domains.length > 0 && !hostMatches(result.url, domains)) return false;
      if (excluded.length > 0 && hostMatches(result.url, excluded)) return false;
      seen.add(result.url);
      return true;
    })
    .slice(0, count)
    .map((result) => ({
      url: result.url,
      title: compact(result.title).slice(0, SEARCH_TITLE_LIMIT),
      snippet: compact(result.snippet).slice(0, SEARCH_SNIPPET_LIMIT),
    }));
}

type SearchConfig = WebSearchEntry | null;

function configFingerprint(config: SearchConfig): string {
  const safe = config
    ? Object.fromEntries(
        Object.entries(config).map(([key, value]) => [
          key,
          key.toLowerCase().includes('key') || key === 'headers'
            ? createHash('sha256').update(JSON.stringify(value)).digest('hex')
            : value,
        ]),
      )
    : null;
  return createHash('sha256').update(JSON.stringify(safe)).digest('hex').slice(0, 16);
}

async function performWebSearch(
  query: string,
  count: number,
  freshness: string | undefined,
  options: SearchOptions,
  config: SearchConfig,
): Promise<SearchResponse> {
  const startedAt = Date.now();
  const raw = !config
    ? await searchBingFallback(query, count, freshness)
    : config.provider === 'brave'
      ? await searchBrave(query, count, freshness, config.apiKey)
      : config.provider === 'google'
        ? await searchGoogle(query, count, config.apiKey, config.cx)
        : config.provider === 'deepseek'
          ? await searchDeepSeek(query, count, config.apiKey)
          : await searchCustomEndpoint(query, config.url, config.headers);
  return {
    query,
    provider: config?.provider ?? 'bing',
    ...(config ? {} : { fallback: true }),
    results: compactResults(raw, count, options),
    cacheHit: false,
    fetchedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
  };
}

/** 联网搜索工具。domains/excludeDomains 在本地按 URL 主机名过滤；refresh 跳过缓存。 */
export async function webSearch(
  query: string,
  count = 5,
  freshness?: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const safeCount = Math.min(10, Math.max(1, Math.floor(count)));
  const normalizedQuery = query.trim();
  const config = readWebSearchConfig();
  const key = JSON.stringify([
    normalizedQuery,
    safeCount,
    freshness ?? '',
    normalizeDomains(options.domains),
    normalizeDomains(options.excludeDomains),
    configFingerprint(config),
  ]);
  const now = Date.now();
  if (!options.refresh) {
    const cached = searchCache.get(key);
    if (cached && cached.expiresAt > now) return { ...cached.response, cacheHit: true };
    searchCache.delete(key);
    const pending = searchInflight.get(key);
    if (pending) return { ...(await pending), cacheHit: true };
  }
  let pending: Promise<SearchResponse>;
  pending = performWebSearch(normalizedQuery, safeCount, freshness, options, config).then(
    (response) => {
      if (searchInflight.get(key) === pending) {
        searchInflight.delete(key);
        searchCache.delete(key);
        searchCache.set(key, { response, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
        while (searchCache.size > SEARCH_CACHE_LIMIT)
          searchCache.delete(searchCache.keys().next().value!);
      }
      return response;
    },
    (error) => {
      if (searchInflight.get(key) === pending) searchInflight.delete(key);
      throw error;
    },
  );
  searchInflight.set(key, pending);
  return pending;
}
