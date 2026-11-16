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
import { decodeEntities, stripTags } from './html-text';

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

/** 招聘、宣讲这类活动信息散落在学校站点、公众号与招聘平台，单条查询通常只召回其中一种来源。 */
export type SearchMode = 'campus-recruit' | 'campus-policy';
type SearchSource = 'official' | 'wechat' | 'wechat-search' | 'job-board' | 'web';
type SearchOptions = {
  domains?: string[];
  excludeDomains?: string[];
  refresh?: boolean;
  mode?: SearchMode;
};
type SearchHit = WebSearchResult & { source?: SearchSource };
type SearchResponse = {
  query: string;
  provider: string;
  results: SearchHit[];
  queries?: string[];
  warnings?: string[];
  /** 搜狗微信发现层：命中时说明实际查询与条数，失败时只记原因（不影响整体结果）。 */
  wechat?: { query: string; found: number } | { error: string };
  mode?: SearchMode;
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
  publisher?: string;
  publishedAt?: string;
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
/** 解析必应结果页：结果条目是 `<li class="b_algo">`，标题在其中的 `<h2><a href>`，
 *  摘要取 `b_caption` 里的第一个 `<p>`。 */
export function parseBingResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blocks =
    html.match(/<li\b[^>]*\bclass\s*=\s*(["'])[^"']*\bb_algo\b[^"']*\1[^>]*>[\s\S]*?<\/li>/gi) ??
    [];
  for (const block of blocks) {
    const link =
      /<h2\b[^>]*>[\s\S]*?<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = stripTags(link[2] ?? '');
    if (!/^https?:\/\//i.test(url)) continue;
    const snippet =
      /<p\b[^>]*\bclass\s*=\s*(["'])[^"']*\bb_lineclamp[^"']*\1[^>]*>([\s\S]*?)<\/p>/i.exec(
        block,
      ) ??
      /<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\bb_caption[^"']*\1[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(
        block,
      );
    results.push({
      url,
      title: stripTags(link[3] ?? '') || url,
      snippet: snippet ? stripTags(snippet[2] ?? snippet[1] ?? '') : '',
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

/** 解析 360 搜索结果页：条目是 `<li class="res-list">`，真实地址优先取 data-mdurl。 */
export function parseSoResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const block of html.split('<li class="res-list').slice(1)) {
    const mdurl = /\bdata-mdurl="([^"]+)"/i.exec(block)?.[1];
    const anchor =
      /<h3\b[^>]*>[\s\S]*?<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const url = stripTags(mdurl ?? anchor?.[2] ?? '');
    if (!/^https?:\/\//i.test(url) || !anchor) continue;
    const snippet =
      /<p\b[^>]*\bclass\s*=\s*(["'])[^"']*\bres-desc[^"']*\1[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    results.push({
      url,
      title: stripTags(anchor[3] ?? '') || url,
      snippet: snippet ? stripTags(snippet[2] ?? '') : '',
    });
  }
  return results;
}

/** 必应结果与查询明显不相关时（免密钥兜底常见），换 360 搜索补一路。 */
async function searchSoFallback(query: string): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`https://www.so.com/s?${params}`, {
    headers: {
      'user-agent': FALLBACK_UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw searchError(response.status);
  return parseSoResults(await response.text());
}

/** 搜狗微信搜索的中转链接：只接受站内 /link 或公众号文章直链，空 href 会退化成站点根。 */
function sogouArticleUrl(raw: string): string | null {
  const href = decodeEntities(raw).trim();
  if (!href || href === '#' || /^(?:javascript|mailto|data):/i.test(href)) return null;
  let url: URL;
  try {
    url = new URL(href, 'https://weixin.sogou.com');
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.hostname !== 'weixin.sogou.com' && url.hostname !== 'mp.weixin.qq.com') return null;
  if (url.pathname === '/') return null;
  url.hash = '';
  return url.href;
}

const WECHAT_CHALLENGE = /antispider|请输入验证码|此验证码用于确认|VerifyCode|网络不给力/i;

/** 搜狗用 `<em>` 标命中词；中文标题里不能把它变成空格，否则会和原文标题对不上。 */
function inlineText(html: string): string {
  return stripTags(html.replace(/<\/?(?:em|b|strong|i|span|font)\b[^>]*>/gi, ''));
}

/** 解析搜狗微信结果页：条目在 `<li>` 内的 `div.txt-box`，标题是 `h3 a`，
 *  摘要在 `p.txt-info`，公众号名在 `a.account`，时间在 `.s-p[t="<unix秒>"]`。
 *  微信文章普遍不被通用搜索收录，所以这一层常是唯一能召回学院公众号活动的入口。 */
export function parseSogouWechatResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const block of html.split(/<li\b/i).slice(1)) {
    if (!/\btxt-box\b/i.test(block)) continue;
    const link =
      /<h3\b[^>]*>[\s\S]*?<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = sogouArticleUrl(link[2] ?? '');
    const title = inlineText(link[3] ?? '');
    if (!url || !title || seen.has(url)) continue;
    const snippet =
      /<p\b[^>]*\bclass\s*=\s*(["'])[^"']*\btxt-info\b[^"']*\1[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const account =
      /<a\b[^>]*\bclass\s*=\s*(["'])[^"']*\baccount\b[^"']*\1[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const published =
      /\bt\s*=\s*"(\d{9,11})"/i.exec(block)?.[1] ?? /timeConvert\('(\d{9,11})'\)/i.exec(block)?.[1];
    seen.add(url);
    results.push({
      url,
      title: title.slice(0, SEARCH_TITLE_LIMIT),
      snippet: inlineText(snippet?.[2] ?? '').slice(0, SEARCH_SNIPPET_LIMIT),
      ...(account ? { publisher: inlineText(account[2] ?? '').slice(0, 100) } : {}),
      ...(published ? { publishedAt: new Date(Number(published) * 1000).toISOString() } : {}),
    });
    if (results.length >= 10) break;
  }
  return results;
}

/** 搜狗微信搜索：只读结果页，不跟随文章跳转（正文页由微信加验证码，不尝试绕过）。 */
async function searchSogouWechat(query: string, count: number): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({ type: '2', ie: 'utf8', query });
  const response = await fetch(`https://weixin.sogou.com/weixin?${params}`, {
    headers: {
      'user-agent': FALLBACK_UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`微信搜索失败（HTTP ${response.status}）`);
  const html = await response.text();
  if (WECHAT_CHALLENGE.test(html)) throw new Error('微信搜索触发验证码，未取得结果');
  const results = parseSogouWechatResults(html).slice(0, count);
  if (results.length === 0) throw new Error('微信搜索未返回结果');
  return results;
}

/** 公众号活动常用「宣讲会 / 活动预告」这类标题发布，原查询为空时补一次活动语义再试。 */
async function discoverWechat(
  query: string,
  count: number,
): Promise<{ results: WebSearchResult[]; query: string }> {
  const attempts = [query, `${query} 宣讲会 活动预告`];
  for (const [index, attempt] of attempts.entries()) {
    try {
      const results = await searchSogouWechat(attempt, count);
      if (results.length) return { results, query: attempt };
    } catch (error) {
      // 只有「确实没结果」才换词重试；验证码与网络错误不重试，避免加倍触发反爬。
      if (index === 0 && /未返回结果/.test(String(error))) continue;
      throw error;
    }
  }
  throw new Error('微信搜索未返回结果');
}

/** 粗粒度相关性判断：结果标题/摘要/URL 去空白后，需至少命中两个查询词才认为相关；
 *  单词查询无法这样判断，视为相关（不触发降级）。 */
function looksRelevant(query: string, results: WebSearchResult[]): boolean {
  const tokens = query.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length < 2 || results.length === 0) return true;
  return results.some((result) => {
    const haystack = `${result.title} ${result.snippet} ${result.url}`.replace(/\s+/g, '');
    return tokens.filter((token) => haystack.includes(token)).length >= 2;
  });
}

/** 免密钥兜底：必应优先，结果与查询明显不相关时自动换 360 搜索补一路；
 *  返回实际采用的来源名，供响应标注。 */
async function searchFreeFallback(
  query: string,
  count: number,
  freshness: string | undefined,
): Promise<{ results: WebSearchResult[]; provider: string; switched: boolean }> {
  const results = await searchBingFallback(query, count, freshness);
  if (looksRelevant(query, results)) return { results, provider: 'bing', switched: false };
  try {
    const soResults = await searchSoFallback(query);
    if (soResults.length > 0) return { results: soResults, provider: 'so', switched: true };
  } catch {
    // 360 也失败时保留必应结果，不因降级把仅剩的来源丢掉。
  }
  return { results, provider: 'bing', switched: false };
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

const JOB_BOARD_HOSTS = [
  'zhaopin.com',
  'liepin.com',
  '51job.com',
  'nowcoder.com',
  'yingjiesheng.com',
  'zhipin.com',
  'shixiseng.com',
];
const SOURCE_RANK: Record<SearchSource, number> = {
  official: 0,
  wechat: 1,
  'wechat-search': 2,
  'job-board': 3,
  web: 4,
};

function sourceOf(url: string): SearchSource {
  const host = new URL(url).hostname.toLowerCase();
  const belongs = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (belongs('scu.edu.cn')) return 'official';
  if (host === 'weixin.sogou.com') return 'wechat-search';
  if (belongs('weixin.qq.com')) return 'wechat';
  if (JOB_BOARD_HOSTS.some(belongs)) return 'job-board';
  return 'web';
}

function compactResults(
  results: WebSearchResult[],
  count: number,
  options: SearchOptions,
  annotate = false,
): SearchHit[] {
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
      ...(result.publisher ? { publisher: result.publisher } : {}),
      ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
      ...(annotate ? { source: sourceOf(result.url) } : {}),
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

function expandQueries(query: string, mode: SearchMode | undefined): string[] {
  if (mode === 'campus-recruit')
    return [
      query,
      `${query} 宣讲会 双选会`,
      `site:scu.edu.cn ${query}`,
      `site:mp.weixin.qq.com ${query}`,
    ];
  // 政策/细则/通知类：少用活动语义词，补精确短语与官方域名约束，避免被宽泛结果淹没。
  if (mode === 'campus-policy') return [query, `site:scu.edu.cn ${query}`, `${query} 通知 公示`];
  return [query];
}

async function searchOnce(
  query: string,
  count: number,
  freshness: string | undefined,
  config: SearchConfig,
): Promise<{ results: WebSearchResult[]; provider: string; switched: boolean }> {
  if (!config) return searchFreeFallback(query, count, freshness);
  const results =
    config.provider === 'brave'
      ? await searchBrave(query, count, freshness, config.apiKey)
      : config.provider === 'google'
        ? await searchGoogle(query, count, config.apiKey, config.cx)
        : config.provider === 'deepseek'
          ? await searchDeepSeek(query, count, config.apiKey)
          : await searchCustomEndpoint(query, config.url, config.headers);
  return { results, provider: config.provider, switched: false };
}

async function performWebSearch(
  query: string,
  count: number,
  freshness: string | undefined,
  options: SearchOptions,
  config: SearchConfig,
): Promise<SearchResponse> {
  const startedAt = Date.now();
  const queries = expandQueries(query, options.mode);
  // 公众号文章多数不被通用搜索收录，招聘模式再补一路搜狗微信结果页（只取标题与摘要）。
  const wechatDiscovery =
    options.mode === 'campus-recruit' ? discoverWechat(query, count) : Promise.resolve(null);
  const [settled, wechat] = await Promise.all([
    Promise.allSettled(queries.map((item) => searchOnce(item, count, freshness, config))),
    wechatDiscovery.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    ),
  ]);
  const merged: WebSearchResult[] = [];
  const warnings: string[] = [];
  const errors: unknown[] = [];
  const seen = new Set<string>();
  const providers = new Set<string>();
  let switched = false;
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      errors.push(outcome.reason);
      const reason =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      warnings.push(`${queries[index]}：${reason}`);
      return;
    }
    providers.add(outcome.value.provider);
    if (outcome.value.switched) switched = true;
    for (const result of outcome.value.results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      merged.push(result);
    }
  });
  let wechatReport: SearchResponse['wechat'];
  if (wechat?.ok && wechat.value) {
    providers.add('sogou-wechat');
    for (const result of wechat.value.results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      merged.push(result);
    }
    wechatReport = { query: wechat.value.query, found: wechat.value.results.length };
  } else if (wechat && !wechat.ok) {
    const reason = wechat.reason instanceof Error ? wechat.reason.message : String(wechat.reason);
    warnings.push(`微信搜索：${reason}`);
    wechatReport = { error: reason };
  }
  // 全部子查询都失败时才报错；部分失败仍返回其余来源，并用 warnings 说明缺了哪一路。
  if (merged.length === 0 && errors.length === queries.length) throw errors[0];
  if (switched) warnings.push('必应结果与查询相关性低，已自动改用 360 搜索补查');
  if (options.mode)
    merged.sort((a, b) => SOURCE_RANK[sourceOf(a.url)] - SOURCE_RANK[sourceOf(b.url)]);
  return {
    query,
    provider: (config?.provider ?? [...providers].join('+')) || 'bing',
    ...(config ? {} : { fallback: true }),
    ...(options.mode ? { mode: options.mode, queries } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(wechatReport ? { wechat: wechatReport } : {}),
    results: compactResults(merged, count, options, Boolean(options.mode)),
    cacheHit: false,
    fetchedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
  };
}

/** 联网搜索工具。domains/excludeDomains 在本地按 URL 主机名过滤；refresh 跳过缓存；
 *  mode=campus-recruit 时把一次查询展开成官方站/公众号/活动语义词多路检索，合并去重并标注来源。 */
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
    options.mode ?? '',
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
