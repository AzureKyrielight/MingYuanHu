/** 统一身份认证（id.scu.edu.cn）password 授权：换取 Bearer token。
 *  密码只在本次调用内使用，不写入磁盘、不进入日志；token 仅保存在主进程内存，退出即失效。 */
import { sm2 } from 'sm-crypto';
import { CampusAuthError } from '../campus';
import { scuRequest } from './client';
import { recognizeCaptchaBase64 } from './ocr/captcha';

const ID_BASE = 'https://id.scu.edu.cn';
const CLIENT_ID = '1371cbeda563697537f28d99b4744a973uDKtgYqL5B';
const ENTERPRISE = 'scdx';
/** 与服务端 session 一致的本地 TTL；过期后需要重新登录。 */
const TOKEN_TTL_MS = 60 * 60 * 1000;

const ID_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json;charset=UTF-8',
  Origin: ID_BASE,
  Referer: `${ID_BASE}/frontend/login`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

export interface ScuIdentityState {
  readonly connected: boolean;
  readonly principal: string | null;
  readonly expiresAt: string | null;
}

interface TokenSession {
  token: string;
  principal: string;
  loginAt: number;
}

let session: TokenSession | null = null;
/** 已用 token 建立过 id.scu.edu.cn cookie session 的账号；换账号或退出时清空。 */
let boundPrincipal: string | null = null;

export function identityState(): ScuIdentityState {
  const alive = session !== null && Date.now() - session.loginAt < TOKEN_TTL_MS;
  return {
    connected: alive,
    principal: alive ? session!.principal : null,
    expiresAt: alive ? new Date(session!.loginAt + TOKEN_TTL_MS).toISOString() : null,
  };
}

export function clearIdentity(): void {
  session = null;
  boundPrincipal = null;
}

/** 供需要 Bearer 的子系统使用；token 失效时抛出可引导重新登录的错误。 */
export function accessToken(): string {
  if (!session || Date.now() - session.loginAt >= TOKEN_TTL_MS) {
    throw new CampusAuthError('统一认证 token 已失效，请重新登录');
  }
  return session.token;
}

export function authorizationHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${accessToken()}` };
}

/**
 * 用 Bearer token 调 `session/save`，在校园分区里种下 id.scu.edu.cn 的 cookie session。
 * 微服务（wfw）、缴费平台、办事大厅、体测都靠这条 cookie 走 CAS SSO；
 * 只有 token 而没有 cookie session 时，它们会统一报“登录已失效”。
 * 没有 token（纯网页登录路径）时返回 false，交由浏览器已建立的 cookie。
 */
export async function bindIdentitySession(): Promise<boolean> {
  if (!session || Date.now() - session.loginAt >= TOKEN_TTL_MS) return false;
  if (boundPrincipal === session.principal) return true;
  const response = await scuRequest(`${ID_BASE}/api/bff/v1.2/commons/session/save`, {
    method: 'POST',
    headers: { ...ID_HEADERS, ...authorizationHeaders() },
    body: '{}',
    timeoutMs: 20_000,
  });
  if (response.status === 401 || response.status === 403) {
    throw new CampusAuthError('统一认证 token 已失效，请重新登录');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`统一认证 session/save 失败（HTTP ${response.status}）`);
  }
  const body = bodyJson<{ success?: unknown; error?: unknown }>(response.body, '统一认证');
  if (typeof body.error === 'string' && /invalid_token/i.test(body.error)) {
    throw new CampusAuthError('统一认证 token 已失效，请重新登录');
  }
  if (body.success !== true) throw new Error('统一认证 session/save 未成功');
  boundPrincipal = session.principal;
  return true;
}

function bodyJson<T>(body: string, service: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${service}返回了无法识别的数据`);
  }
}

/** 登录验证码：图片是 base64（可能带 data URL 前缀），code 登录时原样回传。 */
export async function fetchLoginCaptcha(): Promise<{ code: string; image: string }> {
  const response = await scuRequest(
    `${ID_BASE}/api/public/bff/v1.2/one_time_login/captcha?_enterprise_id=${ENTERPRISE}&timestamp=${Date.now()}`,
    { headers: ID_HEADERS, timeoutMs: 20_000 },
  );
  if (response.status < 200 || response.status >= 300)
    throw new Error(`验证码接口返回 ${response.status}`);
  const body = bodyJson<{ data?: { captcha?: unknown; code?: unknown } }>(response.body, '验证码');
  const image = typeof body.data?.captcha === 'string' ? body.data.captcha : '';
  const code = typeof body.data?.code === 'string' ? body.data.code : '';
  if (!image || !code) throw new Error('验证码字段解析失败');
  return { code, image };
}

async function fetchSm2Key(): Promise<{ publicKey: string; code: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await scuRequest(`${ID_BASE}/api/public/bff/v1.2/sm2_key`, {
        method: 'POST',
        headers: ID_HEADERS,
        body: '{}',
        timeoutMs: 20_000,
      });
      if (response.status < 200 || response.status >= 300) continue;
      const body = bodyJson<{ data?: { publicKey?: unknown; code?: unknown } }>(
        response.body,
        'SM2 公钥',
      );
      const publicKey = typeof body.data?.publicKey === 'string' ? body.data.publicKey : '';
      const code = typeof body.data?.code === 'string' ? body.data.code : '';
      if (publicKey && code) return { publicKey, code };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    lastError instanceof Error ? `SM2 公钥接口异常：${lastError.message}` : 'SM2 公钥接口返回异常',
  );
}

/** base64 公钥（64 或 65 字节）→ sm-crypto 需要的未压缩点十六进制（带 04 前缀）。 */
function publicKeyHex(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 64) return `04${bytes.toString('hex')}`;
  if (bytes.length === 65 && bytes[0] === 4) return bytes.toString('hex');
  throw new Error('SM2 公钥格式异常');
}

/** 与服务端约定一致的 SM2 C1C2C3 密文：base64(04 || C1 || C2 || C3)。 */
export function encryptPassword(password: string, publicKeyBase64: string): string {
  const encrypted = sm2.doEncrypt(password, publicKeyHex(publicKeyBase64), 0);
  return Buffer.concat([Buffer.from([4]), Buffer.from(encrypted, 'hex')]).toString('base64');
}

export async function loginWithPassword(input: {
  username: string;
  password: string;
  captchaCode: string;
  captchaText: string;
}): Promise<ScuIdentityState> {
  const username = input.username.trim();
  if (!/^\d{6,20}$/.test(username)) throw new Error('请输入学号');
  if (!input.password) throw new Error('请输入统一身份认证密码');
  if (!input.captchaCode || !input.captchaText.trim()) throw new Error('请输入验证码');

  const key = await fetchSm2Key();
  const payload = {
    client_id: CLIENT_ID,
    grant_type: 'password',
    scope: 'read',
    username,
    password: encryptPassword(input.password, key.publicKey),
    _enterprise_id: ENTERPRISE,
    sm2_code: key.code,
    cap_code: input.captchaCode,
    cap_text: input.captchaText.trim(),
  };
  const response = await scuRequest(`${ID_BASE}/api/public/bff/v1.2/rest_token`, {
    method: 'POST',
    headers: ID_HEADERS,
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`登录失败：${explainLoginError(response.body, response.status)}`);
  }
  const result = bodyJson<{
    success?: unknown;
    message?: unknown;
    msg?: unknown;
    data?: { access_token?: unknown };
  }>(response.body, '登录');
  if (result.success !== true) {
    const message =
      (typeof result.message === 'string' && result.message) ||
      (typeof result.msg === 'string' && result.msg) ||
      '登录失败';
    throw new Error(message === 'invalid_captcha' ? '验证码错误，请重试' : message);
  }
  const token = typeof result.data?.access_token === 'string' ? result.data.access_token : '';
  if (!token) throw new Error('登录响应缺少 token');
  session = { token, principal: username, loginAt: Date.now() };
  return identityState();
}

/** 服务端对“密码错误”与“验证码错误”都会返回 invalid_grant，只能按文案分辨。 */
export function isCaptchaFailure(message: string): boolean {
  return /invalid_captcha|captcha|验证码/i.test(message);
}

interface LoginErrorBody {
  readonly message?: unknown;
  readonly msg?: unknown;
  readonly data?: { readonly error_description?: unknown };
}

/** 把统一认证的失败码翻译成可操作的提示；无法识别时保留原始文案。 */
export function explainLoginError(body: string, status: number): string {
  let parsed: LoginErrorBody | null = null;
  try {
    parsed = JSON.parse(body) as LoginErrorBody;
  } catch {
    parsed = null;
  }
  const message =
    (typeof parsed?.message === 'string' && parsed.message) ||
    (typeof parsed?.msg === 'string' && parsed.msg) ||
    (typeof parsed?.data?.error_description === 'string' && parsed.data.error_description) ||
    '';
  if (/locked/i.test(message)) {
    return '账号已被临时锁定（连续登录失败），请约 5 分钟后再试';
  }
  const willLock = /login_failed_will_lock_(\d+)_(\d+)/.exec(message);
  if (willLock) {
    const attempted = Number(willLock[1]);
    const total = Number(willLock[2]);
    const remaining = total > attempted ? total - attempted : 1;
    return `学号或密码不正确（连续失败第 ${attempted} 次，再错 ${remaining} 次将临时锁定账号）`;
  }
  if (/invalid_captcha/i.test(message)) return '验证码错误，请重试';
  if (/invalid_grant/i.test(message)) return `学号或密码不正确（HTTP ${status}）`;
  return message ? `${message}（HTTP ${status}）` : `HTTP ${status}`;
}

/**
 * 自动登录：本地 OCR 识别验证码后提交。
 * 仅在“识别失败未提交”或“服务端明确报验证码错误”时换新验证码重试，
 * 密码错误立即抛错，避免把账号试到锁。
 */
export async function loginWithPasswordAuto(input: {
  username: string;
  password: string;
}): Promise<ScuIdentityState> {
  const attempts = 4;
  let lastError = '验证码识别失败，请手动输入';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const captcha = await fetchLoginCaptcha();
    const recognition = recognizeCaptchaBase64(captcha.image);
    if (!recognition.text) continue;
    try {
      return await loginWithPassword({
        username: input.username,
        password: input.password,
        captchaCode: captcha.code,
        captchaText: recognition.text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 只有“验证码没识别出来”或服务端明确报验证码错误才换图重试；
      // 账号锁定/密码错误一律立即中止，避免继续累加失败次数。
      if (isCaptchaFailure(message)) {
        lastError = '验证码识别失败，请重试';
        continue;
      }
      throw error;
    }
  }
  throw new Error(lastError);
}
