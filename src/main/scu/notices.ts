/** 川大教务处通知公告（jwc.scu.edu.cn）：列表 + 详情正文。 */
import type { ScuNotice, ScuNoticeDetail } from '../../shared/scu';

const BASE = 'https://jwc.scu.edu.cn';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type JwcNotice = ScuNotice;
export type JwcNoticeDetail = ScuNoticeDetail;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function plain(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`教务处页面返回 HTTP ${response.status}`);
    return decodeHtml(
      new Uint8Array(await response.arrayBuffer()),
      response.headers.get('content-type'),
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 按 Content-Type 或 <meta charset> 解码 HTML，缺省 UTF-8。
 * 站点当前是 UTF-8（曾按 GB18030 解出整页乱码），因此不能写死编码；
 * gbk/gb2312 统一交给 gb18030 解码器（超集）。
 */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const declared =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(
      new TextDecoder('latin1').decode(bytes.subarray(0, 2048)),
    )?.[1];
  const label = (declared ?? 'utf-8').toLowerCase();
  const normalized = label === 'gb2312' || label === 'gbk' ? 'gb18030' : label;
  try {
    return new TextDecoder(normalized).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const ITEM_PATTERN =
  /<li>\s*<a href="(info\/\d+\/\d+\.htm)"[^>]*>[\s\S]*?<div class="date">\s*<p>\s*([\d/]+)\s*<\/p>\s*<span>\s*(\d{4})\s*<\/span>[\s\S]*?<div class="text">\s*<p>([\s\S]*?)<\/p>/g;

function listPath(page: number): string {
  return page <= 1 ? `${BASE}/tzgg.htm` : `${BASE}/tzgg/${page}.htm`;
}

/** 通知列表（第 1 页为 tzgg.htm，之后为 tzgg/N.htm）。 */
export async function fetchJwcNotices(page = 1): Promise<JwcNotice[]> {
  const html = await fetchHtml(listPath(Math.max(1, Math.min(20, Math.trunc(page)))));
  const notices = parseNoticeList(html);
  if (notices.length === 0) throw new Error('教务处通知列表解析失败（页面结构可能已变化）');
  return notices;
}

/** 解析列表页 HTML（纯函数，便于单测）。 */
export function parseNoticeList(html: string): JwcNotice[] {
  const notices: JwcNotice[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(ITEM_PATTERN)) {
    const path = match[1] ?? '';
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const monthDay = (match[2] ?? '').trim();
    const year = (match[3] ?? '').trim();
    const [month, day] = monthDay.split('/');
    notices.push({
      id: path,
      title: plain(match[4] ?? ''),
      date: month && day ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : year,
      url: `${BASE}/${path}`,
    });
  }
  return notices;
}

/** 从某个 <div> 的起始标签处按深度提取完整内容。 */
function extractDiv(html: string, startIndex: number): string {
  const open = /<div\b[^>]*>/gi;
  open.lastIndex = startIndex;
  const first = open.exec(html);
  if (!first) return '';
  const contentStart = first.index + first[0].length;
  let depth = 1;
  const tags = /<div\b[^>]*>|<\/div>/gi;
  tags.lastIndex = contentStart;
  for (;;) {
    const match = tags.exec(html);
    if (!match) break;
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(contentStart, match.index);
  }
  return html.slice(contentStart);
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 通知详情：标题、发布时间与正文纯文本。 */
export async function fetchJwcNotice(url: string): Promise<JwcNoticeDetail> {
  const id = /info\/\d+\/\d+\.htm/.exec(url)?.[0];
  if (!id) throw new Error('通知链接格式不正确');
  const html = await fetchHtml(`${BASE}/${id}`);
  return parseNoticeDetail(html, id);
}

/** 解析详情页 HTML（纯函数，便于单测）。 */
export function parseNoticeDetail(html: string, id: string): JwcNoticeDetail {
  const title = plain(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  const time = /添加时间：?\s*(\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ?? '';
  const start = html.indexOf('<div class="v_news_content">');
  const body = start >= 0 ? extractDiv(html, start) : '';
  return {
    id,
    url: `${BASE}/${id}`,
    title,
    date: time,
    content: htmlToText(body),
  };
}
