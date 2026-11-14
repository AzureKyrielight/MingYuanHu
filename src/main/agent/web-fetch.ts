import { htmlToMarkdown } from '@mdream/js';
import { clean } from '@mdream/js/clean';
import { extractionPlugin, filterPlugin } from '@mdream/js/plugins';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { prepareDocumentFile } from '../resources';
import { fetchDeepSeek } from './deepseek';
import { stripInvisible, stripTags } from './html-text';

// 抓取的站点没有官方契约；使用桌面 Chrome UA，降低被判定为机器人的概率。
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 15000;
const PAGE_BYTE_LIMIT = 2 * 1024 * 1024;
const DOCUMENT_BYTE_LIMIT = 128 * 1024 * 1024;
const MAX_REDIRECTS = 5;
// 单次返回的字符数；超出部分经 offset 续读，分页本身不截断。
const TEXT_LIMIT = 20000;

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_LIMIT = 16;
const SNAPSHOT_CHARACTER_LIMIT = 4 * 1024 * 1024;
const snapshots = new Map<string, { page: Snapshot; expiresAt: number }>();
const pending = new Map<string, Promise<Snapshot>>();

interface WebPageContent {
  source: { url: string; fetchedAt: string };
  cache?: { status: 'hit' | 'miss' | 'shared' | 'bypass'; expiresAt?: string };
  title: string | null;
  contentType: string;
  text: string;
  totalCharacters: number;
  nextOffset: number | null;
  truncated: boolean;
  readable?: false;
  document?: Awaited<ReturnType<typeof prepareDocumentFile>>;
  note?: string;
}

type Snapshot = WebPageContent & { cacheable: boolean };

export async function fetchWebPage(
  rawUrl: string,
  offset = 0,
  deepseek?: { apiKey: string },
  options?: { maxChars?: number; refresh?: boolean },
): Promise<WebPageContent> {
  const maxChars = options?.maxChars ?? TEXT_LIMIT;
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset 必须是非负整数');
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > TEXT_LIMIT)
    throw new Error(`maxChars 必须是 1–${TEXT_LIMIT} 的整数`);
  const url = httpUrl(rawUrl);
  url.hash = '';
  const sensitiveUrl = Boolean(
    url.username ||
    url.password ||
    url.search ||
    /\/(?:login|signin|auth|sso)(?:\/|$)/i.test(url.pathname),
  );
  const key = createHash('sha256')
    .update(JSON.stringify([url.toString(), deepseek?.apiKey ?? null]))
    .digest('hex');
  const now = Date.now();
  for (const [storedKey, entry] of snapshots) {
    if (entry.expiresAt <= now) snapshots.delete(storedKey);
  }
  if (options?.refresh) snapshots.delete(key);
  const bypass = sensitiveUrl || options?.refresh;
  const cached = !bypass ? snapshots.get(key) : undefined;
  let page: Snapshot;
  let status: NonNullable<WebPageContent['cache']>['status'];
  let expiresAt = cached?.expiresAt;
  if (cached) {
    page = cached.page;
    snapshots.delete(key);
    snapshots.set(key, cached);
    status = 'hit';
  } else {
    const inFlight = !bypass ? pending.get(key) : undefined;
    status = bypass ? 'bypass' : inFlight ? 'shared' : 'miss';
    const request = inFlight ?? loadWebPage(url.toString(), deepseek);
    if (!sensitiveUrl && !inFlight && (pending.has(key) || pending.size < SNAPSHOT_LIMIT))
      pending.set(key, request);
    let latestRequest = false;
    try {
      page = await request;
      latestRequest = pending.get(key) === request;
    } finally {
      if (pending.get(key) === request) pending.delete(key);
    }
    // Each PDF caller owns its own releasable document task.
    if (inFlight && page.document) page = await loadWebPage(url.toString(), deepseek);
    if (
      !sensitiveUrl &&
      page.cacheable &&
      page.text.length <= SNAPSHOT_CHARACTER_LIMIT &&
      (latestRequest || snapshots.get(key)?.page === page)
    ) {
      expiresAt = Date.parse(page.source.fetchedAt) + SNAPSHOT_TTL_MS;
      snapshots.delete(key);
      snapshots.set(key, { page, expiresAt });
      let characters = 0;
      for (const entry of snapshots.values()) characters += entry.page.text.length;
      while (snapshots.size > SNAPSHOT_LIMIT || characters > SNAPSHOT_CHARACTER_LIMIT) {
        const oldest = snapshots.keys().next().value!;
        characters -= snapshots.get(oldest)!.page.text.length;
        snapshots.delete(oldest);
      }
    } else {
      status = 'bypass';
    }
  }
  const { cacheable: _cacheable, ...content } = page;
  const nextOffset = offset + maxChars < page.text.length ? offset + maxChars : null;
  const note = [
    page.note,
    ...(nextOffset !== null
      ? [
          `正文共 ${page.text.length} 字符，本次返回第 ${offset}–${nextOffset} 字符；传 offset=${nextOffset} 续读`,
        ]
      : []),
  ]
    .filter(Boolean)
    .join('；');
  return {
    ...content,
    text: page.text.slice(offset, offset + maxChars),
    nextOffset,
    cache: { status, ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) },
    ...(note ? { note } : {}),
  };
}

async function loadWebPage(rawUrl: string, deepseek?: { apiKey: string }): Promise<Snapshot> {
  const fetchedAt = new Date().toISOString();
  let cacheable = true;
  const finish = (
    url: URL,
    title: string | null,
    contentType: string,
    fullText: string,
    bytesTruncated: boolean,
    extraNotes: string[] = [],
  ): Snapshot => {
    const notes = [...extraNotes];
    if (bytesTruncated) notes.push('页面超过 2MB 读取上限，内容可能不完整');
    const blocked =
      /(?:sign in|log in|login|access denied|just a moment|verify you are human|captcha|登录|登陆|访问受限|验证码|人机验证)/i;
    return {
      cacheable:
        cacheable &&
        Boolean(fullText.trim()) &&
        !blocked.test(title ?? '') &&
        !(fullText.length < 2000 && blocked.test(fullText)),
      source: { url: url.toString(), fetchedAt },
      title,
      contentType,
      text: fullText,
      totalCharacters: fullText.length,
      nextOffset: null,
      truncated: bytesTruncated,
      ...(notes.length ? { note: notes.join('；') } : {}),
    };
  };
  let url = httpUrl(rawUrl);
  if (deepseek && !looksLikePdfUrl(url)) {
    try {
      const page = await fetchDeepSeek(url.toString(), deepseek.apiKey);
      if (page.text.trim())
        return finish(url, page.title, 'text/markdown', page.text.replace(/\r\n/g, '\n'), false);
    } catch {
      // 注册了 DeepSeek 也不该让抓取失去可用性：取不到正文（404）或临时故障时回退本地抓取。
    }
  }
  let response: Response | null = null;
  for (let hop = 0; ; hop += 1) {
    response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (
      response.headers.has('set-cookie') ||
      /(?:no-store|private|no-cache)/i.test(response.headers.get('cache-control') ?? '') ||
      /\/(?:login|signin|auth|sso)(?:\/|$)/i.test(url.pathname) ||
      url.search ||
      url.username ||
      url.password
    )
      cacheable = false;
    const location =
      response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) break;
    await response.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new Error('网页重定向次数过多');
    url = httpUrl(new URL(location, url).toString());
  }
  if (!response!.ok) throw new Error(`网页请求失败（HTTP ${response!.status}）`);
  const contentType = response!.headers.get('content-type') ?? '';
  const peeked = await peekResponse(response!);
  const looksLikePdf =
    contentType.toLowerCase().includes('pdf') ||
    new TextDecoder('latin1').decode(peeked.prefix.subarray(0, 5)) === '%PDF-';
  if (looksLikePdf) {
    try {
      const document = await prepareDocumentFile((path) => saveDocument(peeked.response, path));
      return {
        ...finish(url, null, contentType || 'application/pdf', '', false),
        readable: false,
        document,
        note: '此地址返回 PDF，已保存完整临时文件。使用 document-reading skill，直接用 document 中的 python、script、input、output 解析并读取正文或页面图片，无需再次 prepare_document；完成后用 document.jobId 调用 dela release_document。',
      };
    } finally {
      await peeked.response.body?.cancel().catch(() => {});
    }
  }
  if (/^(image|audio|video)\//.test(contentType)) {
    await peeked.response.body?.cancel();
    throw new Error('该地址是媒体文件，不是网页');
  }
  const { bytes, truncated: bytesTruncated } = await readCapped(peeked.response);
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
  let source: string;
  try {
    source = new TextDecoder(charset).decode(bytes);
  } catch {
    source = new TextDecoder().decode(bytes);
  }
  if (/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(source)) cacheable = false;
  const isMarkup = /text\/html|application\/xhtml/i.test(contentType) || !contentType;
  const { title, text } = isMarkup
    ? htmlToPage(source, url.toString())
    : { title: null, text: source };
  let normalized = text.replace(/\r\n/g, '\n');
  const notes: string[] = [];
  // 纯客户端渲染的站点（React/Vue 单页应用）HTML 里几乎没有正文，mdream 只能抽到
  // 「Skip to main content」这类骨架；此时补一次粗粒度兜底（正文 + 站内链接），并明确告知
  // 模型原因，避免它把空内容当成「页面没有信息」而结束任务。
  if (isMarkup && source.length > 2048 && normalized.trim().length < 200) {
    const fallback = rawPageText(source);
    if (fallback.length > normalized.trim().length) normalized = fallback;
    notes.push(
      '该页正文疑似由 JavaScript 动态渲染，HTML 里可提取的文字很少（上面的 text 是兜底抽取，可能只含标题、导航与链接）。需要完整内容时，可改用该站的 sitemap / RSS / 搜索结果的静态页，或检索同一主题的其他来源',
    );
  }
  return finish(url, title, contentType || 'text/html', normalized, bytesTruncated, notes);
}

async function peekResponse(response: Response) {
  if (!response.body) return { response, prefix: new Uint8Array() };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < 5) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const prefix = Buffer.concat(chunks);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return { response: new Response(body, { headers: response.headers }), prefix };
}

async function saveDocument(response: Response, path: string): Promise<void> {
  if (Number(response.headers.get('content-length')) > DOCUMENT_BYTE_LIMIT)
    throw new Error('文档超过 128 MiB 下载上限，未解析截断内容');
  const reader = response.body?.getReader();
  const file = await open(path, 'wx');
  let length = 0;
  try {
    if (!reader) throw new Error('文档响应为空');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > DOCUMENT_BYTE_LIMIT)
        throw new Error('文档超过 128 MiB 下载上限，未解析截断内容');
      await file.writeFile(value);
    }
  } finally {
    await file.close();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

const looksLikePdfUrl = (url: URL) => /\.pdf$/i.test(url.pathname);

function httpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('不是有效的 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http(s) 地址');
  return url;
}

async function readCapped(response: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body)
    return { bytes: new Uint8Array(await response.arrayBuffer()), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > PAGE_BYTE_LIMIT) {
      chunks.push(value.subarray(0, PAGE_BYTE_LIMIT - length));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    length += value.length;
  }
  return { bytes: Buffer.concat(chunks), truncated };
}

function htmlToPage(html: string, origin: string): { title: string | null; text: string } {
  let title: string | null = null;
  // 不用 minimal 的正文启发式与 Tailwind 过滤，避免无标题或定位布局的正文被误删。
  const text = htmlToMarkdown(html, {
    origin,
    clean: clean(),
    plugins: [
      extractionPlugin({
        title: (element) => {
          title = element.textContent.trim() || null;
        },
      }),
      filterPlugin({
        exclude: ['nav', 'footer', 'script', 'style', 'noscript', 'svg', 'template'],
      }),
    ],
  });
  return { title, text };
}

/** 正文抽取结果过少时的兜底：整页文本化，并附上前若干个绝对链接，
 *  让模型至少能顺着导航继续找内容，而不是拿到一页空白。 */
function rawPageText(html: string): string {
  const visible = stripInvisible(html);
  const body = stripTags(visible).slice(0, TEXT_LIMIT);
  const seen = new Set<string>();
  const links: string[] = [];
  for (const match of visible.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = (match[1] ?? '').trim();
    const label = stripTags(match[2] ?? '');
    if (!/^https?:\/\//i.test(href) || !label || seen.has(href)) continue;
    seen.add(href);
    links.push(`- [${label}](${href})`);
    if (links.length >= 40) break;
  }
  return links.length > 0 ? `${body}\n\n页面上的链接：\n${links.join('\n')}` : body;
}
