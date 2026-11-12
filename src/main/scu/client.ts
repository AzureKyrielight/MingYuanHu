/** 川大校园请求的统一传输层：复用课表登录窗建立的 Chromium 校园会话。 */
import { session } from 'electron';
import { CAMPUS_PARTITION, CampusAuthError } from '../campus';

const REQUEST_TIMEOUT_MS = 20_000;

export interface ScuResponse {
  readonly url: string;
  readonly status: number;
  readonly body: string;
  readonly contentType: string;
}

export interface ScuRequestInit {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  /** 表单/JSON 用字符串；multipart 上传用 Uint8Array（会按 Content-Length 发送）。 */
  readonly body?: string | Uint8Array;
  readonly timeoutMs?: number;
}

function campusSession() {
  return session.fromPartition(CAMPUS_PARTITION);
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

export async function scuRequest(url: string, init: ScuRequestInit = {}): Promise<ScuResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await campusSession().fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body,
      // 主进程没有页面 origin，必须显式带上分区内的 Cookie。
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await response.text();
    const result: ScuResponse = {
      url: response.url || url,
      status: response.status,
      body,
      contentType: response.headers.get('content-type') ?? '',
    };
    if (response.status === 401 || response.status === 403) {
      throw new CampusAuthError('校园登录已失效，请重新连接四川大学统一身份认证');
    }
    return result;
  } catch (error) {
    if (error instanceof CampusAuthError) throw error;
    if (controller.signal.aborted) {
      throw new Error('校园服务请求超时，请检查网络后重试', { cause: error });
    }
    throw new Error('无法连接校园服务，请检查网络后重试', { cause: error });
  } finally {
    clearTimeout(timer);
  }
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

/** 子系统 SSO 预热：带校园会话跟随完整跳转链，最终仍落在登录页则视为未登录。 */
export async function bootstrapSso(url: string, service: string): Promise<ScuResponse> {
  const response = await scuRequest(url, {
    headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
    timeoutMs: 30_000,
  });
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
