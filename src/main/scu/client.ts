/** 川大校园请求的统一传输层：自带 cookie jar 并逐跳跟随重定向，语义对齐 SCU-CLI 的
 *  CookieClient（Go net/http）。不用 Electron 的网络栈，原因有二：
 *  `session.fetch` 跟随跳转后 `Response.url` 恒为空（取不到 sp_logged 的 code、jwt31 的
 *  userinfo、打印回跳的 code）；`net.request` 读不到 3xx 响应、也无法逐跳改 header，
 *  因此中间跳下发的 cookie（CAS 的 PHPSESSID 等）会丢。 */
import { session } from 'electron';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { CAMPUS_PARTITION, CampusAuthError } from '../campus';
import { CookieJar, seedCookie } from './cookie-jar';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 10;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/** 缺省 UA：newservice 等分支按 UA 判定客户端，缺省会直接报 CODE_ERROR。 */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

/** 主进程诊断日志：SCU_DEBUG=1 时打印；只输出脱敏信息（域名/路径/布尔），不输出票据。 */
export function scuDebug(label: string, detail: string): void {
  if (process.env.SCU_DEBUG) console.log(`[scu:${label}] ${detail}`);
}

export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export interface ScuResponse {
  readonly url: string;
  readonly status: number;
  readonly body: string;
  readonly contentType: string;
}

export interface ScuRequestInit {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  /** 表单/JSON 用字符串；multipart 上传用 Uint8Array（按 Content-Length 发送）。 */
  readonly body?: string | Uint8Array;
  readonly timeoutMs?: number;
}

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

/** 分区 cookie 只在首次请求时导入，之后以内存 jar 为准（含各跳下发的 Set-Cookie）。 */
let jar: CookieJar | null = null;

function campusSession() {
  return session.fromPartition(CAMPUS_PARTITION);
}

async function cookieJar(): Promise<CookieJar> {
  if (jar) return jar;
  const stored = await campusSession().cookies.get({ domain: 'scu.edu.cn' });
  jar = new CookieJar(
    stored
      .filter((cookie) => cookie.domain)
      .map((cookie) => seedCookie({ ...cookie, domain: cookie.domain ?? '' })),
  );
  return jar;
}

/** 退出登录或重新连接统一认证时丢弃 jar，下次请求重新从分区导入。 */
export function resetScuCookies(): void {
  jar = null;
}

/** 丢弃某域名下的 jar cookie（含子域），用于重建统一认证会话。 */
export async function dropScuCookies(domain: string): Promise<void> {
  const cookies = await cookieJar();
  cookies.drop((cookie) => cookie.domain === domain || cookie.domain.endsWith(`.${domain}`));
}

/** 川大域名（含所有子站）判断；登录页与子系统跳转都带这个后缀。 */
export function isScuHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'scu.edu.cn' || host.endsWith('.scu.edu.cn');
  } catch {
    return false;
  }
}

function looksLikeLoginPage(response: ScuResponse): boolean {
  try {
    const url = new URL(response.url);
    if (url.hostname === 'id.scu.edu.cn') return true;
  } catch {
    // 无法解析的最终地址交给正文判断。
  }
  const head = response.body.slice(0, 4096).toLowerCase();
  return (
    head.includes('<title>统一身份认证') ||
    head.includes('/frontend/login') ||
    head.includes('one_time_login') ||
    (head.includes('name="password"') && head.includes('captcha'))
  );
}

function headerOf(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function requestOnce(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string | Uint8Array },
  timeoutMs: number,
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === 'http:' ? httpRequest : httpsRequest;
    const request = send(
      target,
      { method: init.method, headers: { ...init.headers, 'Accept-Encoding': 'identity' } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function resolveLocation(location: string, base: string): string {
  try {
    // 统一认证回跳的 Location 可能含字面空格，浏览器与 Go 客户端都会做百分号编码。
    return new URL(location.replaceAll(' ', '%20'), base).toString();
  } catch {
    return '';
  }
}

export async function scuRequest(url: string, init: ScuRequestInit = {}): Promise<ScuResponse> {
  const cookies = await cookieJar();
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_USER_AGENT,
    ...(init.headers ?? {}),
  };
  const timeoutMs = init.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let method: 'GET' | 'POST' = init.method ?? 'GET';
  let body = init.body;
  let current = url;
  let prevOrigin = originOf(url);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const cookie = cookies.header(current);
    let raw: RawResponse;
    try {
      raw = await requestOnce(
        current,
        { method, headers: cookie ? { ...headers, Cookie: cookie } : headers, body },
        timeoutMs,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message === 'timeout'
          ? '校园服务请求超时，请检查网络后重试'
          : '无法连接校园服务，请检查网络后重试',
        { cause: error },
      );
    }

    const setCookies = raw.headers['set-cookie'];
    const stored = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
    for (const item of stored) cookies.store(item, current);
    if (stored.length) {
      scuDebug(
        'http',
        `set-cookie ${safeUrl(current)} ${stored
          .map((item) => {
            const semicolon = item.indexOf(';');
            return `${item.slice(0, item.indexOf('='))}${semicolon === -1 ? '' : item.slice(semicolon)}`;
          })
          .join(' || ')}`,
      );
    }
    const status = raw.status;
    const location = headerOf(raw.headers, 'location');
    if (!REDIRECT_STATUS.has(status) || !location) {
      const result: ScuResponse = {
        url: current,
        status,
        body: raw.body,
        contentType: headerOf(raw.headers, 'content-type'),
      };
      if (status === 401 || status === 403) {
        const names = cookie
          .split('; ')
          .filter(Boolean)
          .map((pair) => pair.slice(0, pair.indexOf('=')))
          .join('|');
        scuDebug('http', `auth-fail ${status} ${safeUrl(current)} cookies=${names || '-'}`);
        throw new CampusAuthError('校园登录已失效，请重新连接四川大学统一身份认证');
      }
      return result;
    }

    const next = resolveLocation(location, current);
    if (!next) throw new Error('校园服务跳转地址非法');
    scuDebug('http', `redirect ${status} ${safeUrl(next)}`);
    if (originOf(next) !== prevOrigin) delete headers.Authorization;
    prevOrigin = originOf(next);
    if (status !== 307 && status !== 308) {
      method = 'GET';
      body = undefined;
    }
    current = next;
  }
  throw new Error(`校园服务跳转超过 ${MAX_REDIRECTS} 次`);
}

export function assertAuthenticated(response: ScuResponse, service: string): void {
  if (looksLikeLoginPage(response)) {
    throw new CampusAuthError(`${service}登录已失效，请重新连接四川大学统一身份认证`);
  }
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`${service}接口返回 ${response.status}`);
  }
}

export function parseJson<T>(response: ScuResponse, service: string): T {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new Error(`${service}返回了无法识别的数据`);
  }
}

/** 诊断用：单行描述最终响应（状态、脱敏地址、是否登录页），不含票据。 */
export function describeResponse(response: ScuResponse): string {
  const head = response.body.trimStart().slice(0, 32);
  const kind = head.startsWith('{') || head.startsWith('[') ? 'json' : head ? 'html' : 'empty';
  return `status=${response.status} final=${safeUrl(response.url)} loginPage=${
    looksLikeLoginPage(response) ? 'y' : 'n'
  } body=${kind}`;
}

/** 诊断用：列出 jar 中某域名的 cookie 名（不含值）。 */
export async function cookieNames(domain: string): Promise<string> {
  const cookies = await cookieJar();
  return (
    cookies
      .list()
      .filter((cookie) => cookie.domain === domain || cookie.domain.endsWith(`.${domain}`))
      .map((cookie) => cookie.name)
      .join('|') || '-'
  );
}

/** SSO 中继的授权头提供器（由 identity 模块注入，避免 client 与 identity 循环依赖）。 */
let ssoAuthHeaders: () => Record<string, string> = () => ({});

export function setSsoAuthHeadersProvider(provider: () => Record<string, string>): void {
  ssoAuthHeaders = provider;
}

/**
 * 子系统 SSO 预热：跟随完整跳转链，最终仍落在登录页则视为未登录。
 * Bearer 只发给入口站（service.scu.edu.cn 等），跨域跳转到统一认证时会被剥掉，
 * 与 SCU-CLI 的 CookieClient.FollowRedirects 一致。
 */
export async function bootstrapSso(url: string, service: string): Promise<ScuResponse> {
  const relay = () =>
    scuRequest(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*',
        ...ssoAuthHeaders(),
      },
      timeoutMs: 30_000,
    });
  let response: ScuResponse;
  try {
    response = await relay();
  } catch (error) {
    if (!(error instanceof CampusAuthError)) throw error;
    // 统一认证的 CAS 端点在首次访问时只下发 IDaaS cookie 并回 401，
    // 拿到 cookie 后重放一次即完成中继（与 SCU-CLI 的 RetryOnUnauthenticated 一致）。
    scuDebug('sso', `${service} 首次中继被拒，重试一次`);
    response = await relay();
  }
  scuDebug('sso', `${service} ${describeResponse(response)}`);
  assertAuthenticated(response, service);
  return response;
}

/**
 * 子系统会话失效时重建预热并重试一次，对齐 SCU-CLI 的 RetryOnUnauthenticated。
 * 第二次仍失效才把认证错误抛给调用方。
 */
export async function retryOnAuth<T>(run: () => Promise<T>, reset: () => void): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof CampusAuthError)) throw error;
    reset();
    return run();
  }
}
