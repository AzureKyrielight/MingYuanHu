/**
 * 校园网无感认证（智慧线上服务平台 service.scu.edu.cn/newservice）。
 *
 * 认证是 SSO 中继：`/newservice/api/login/cas?redirect_url=…m_passpoint`，
 * 成功后会话里带 process_uid。响应信封 e==="OK" 表示成功，
 * 具体业务结果在 d.errorCode（0 成功）。
 */
import { BrowserWindow } from 'electron';
import { CAMPUS_PARTITION, CAMPUS_USER_AGENT, CampusAuthError } from '../campus';
import {
  absorbScuCookies,
  cookieNames,
  describeResponse,
  publishScuCookies,
  retryOnAuth,
  safeUrl,
  scuDebug,
  scuRequest,
  type ScuResponse,
} from './client';
import { bindIdentitySession } from './identity';

const BASE = 'https://service.scu.edu.cn/newservice';
const LOGIN = `${BASE}/api/login/cas?redirect_url=${encodeURIComponent(
  `${BASE}/fe/site/m_passpoint?platform_id=31&platform_id=31`,
)}`;

const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'X-Requested-With': 'XMLHttpRequest',
  Origin: 'https://service.scu.edu.cn',
  Referer: `${BASE}/fe/site/m_passpoint`,
};

let ready = false;

export function resetPasspoint(): void {
  ready = false;
}

/**
 * 无感认证的会话必须由浏览器建立：newservice 的业务接口只认「页面导航 + 前端初始化
 * 请求」产生的 process_uid 会话，纯 HTTP 中继拿到的 cookie 一律被判 UN_AUTH。
 * 这里用一个隐藏窗口走真实导航，随后把分区 cookie 回流给传输层。
 */
async function prewarmNewservice(): Promise<void> {
  // 隐藏窗口没有我们 jar 里的统一认证会话，先把 id 域 cookie 推进分区。
  const published = await publishScuCookies('id.scu.edu.cn');
  const window = new BrowserWindow({
    show: false,
    webPreferences: { partition: CAMPUS_PARTITION },
  });
  // 页面的 UA 必须与分区/传输层一致，否则统一认证按 UA 绑定会判 browser mismatch。
  window.webContents.setUserAgent(CAMPUS_USER_AGENT);
  try {
    await window.loadURL(LOGIN);
    // 页面加载后前端还会补几次初始化请求，等它们把会话写全再关窗。
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    scuDebug(
      'passpoint',
      `prewarm ua=${window.webContents.getUserAgent().slice(0, 32)} url=${safeUrl(window.webContents.getURL())}`,
    );
  } finally {
    window.destroy();
  }
  const absorbed = await absorbScuCookies('service.scu.edu.cn');
  scuDebug('passpoint', `prewarm published=${published} absorbed=${absorbed}`);
}

async function ensurePasspoint(): Promise<void> {
  if (ready) return;
  const bound = await bindIdentitySession();
  scuDebug(
    'passpoint',
    `bind=${bound ? 'ok' : 'no-token'} idCookies=${await cookieNames('id.scu.edu.cn')} svcCookies=${await cookieNames('service.scu.edu.cn')}`,
  );
  // 隐藏窗口导航同时完成中继与前端初始化；随后不要再走 HTTP 中继，
  // 否则新的 login/cas 命中会把这个已认证会话重置掉。
  await prewarmNewservice();
  scuDebug('passpoint', `prewarmed svcCookies=${await cookieNames('service.scu.edu.cn')}`);
  ready = true;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

/** 解析 newservice 信封并校验 d.errorCode（0 成功）。 */
export function decodePasspointBody(body: string, status: number): Record<string, unknown> {
  const trimmed = body.trim();
  if (status === 302 || status === 401 || status === 403 || !trimmed)
    throw new CampusAuthError('校园网服务登录已失效');
  // 会话过期但 HTTP 200 时可能直接返回登录页 HTML（与 SCU-CLI 的强特征检测一致）。
  if (trimmed.startsWith('<') && /login|统一身份认证/.test(trimmed.slice(0, 4096)))
    throw new CampusAuthError('校园网服务登录已失效');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('校园网服务返回了无法识别的数据');
  }
  if (!isRecord(parsed)) throw new Error('校园网服务响应结构异常');
  const code = textOf(parsed.e);
  if (code === 'UN_AUTH') throw new CampusAuthError('校园网服务登录已失效');
  if (code !== 'OK') throw new Error(textOf(parsed.m) || '校园网服务暂不可用');
  const data = parsed.d;
  if (!isRecord(data)) throw new Error('校园网服务响应缺少 d 字段');
  const errorCode = textOf(data.errorCode);
  if (errorCode && errorCode !== '0')
    throw new Error(textOf(data.errorMessage) || '校园网服务操作失败');
  return data;
}

/** 业务请求；会话失效（e=UN_AUTH）时重建中继并重放一次，对齐 SCU-CLI 的 RetryOnUnauthenticated。
 *  会话由隐藏窗口导航建立后回流到 jar，所以业务请求仍走统一传输层。 */
async function request(path: string, init: { method?: 'GET' | 'POST'; body?: string } = {}) {
  return retryOnAuth(async () => {
    await ensurePasspoint();
    const response: ScuResponse = await scuRequest(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...HEADERS,
        ...(init.body === undefined
          ? {}
          : { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
      timeoutMs: 25_000,
    });
    scuDebug('passpoint', `req ${path} ${describeResponse(response)}`);
    return decodePasspointBody(response.body, response.status);
  }, resetPasspoint);
}

export interface PasspointDevice {
  readonly mac: string;
  /** 到期日 YYYY-MM-DD；空串表示最长有效期（6 年）。 */
  readonly expireAt: string;
  readonly serviceName: string;
  readonly online: boolean;
}

function mapDevice(raw: unknown): PasspointDevice {
  const value = isRecord(raw) ? raw : {};
  const rawExpire = textOf(value.macExpireTime);
  const expireAt = /^\d{4}-\d{2}-\d{2}/.test(rawExpire) ? rawExpire.slice(0, 10) : '';
  const onlineRaw = value.isOnline;
  return {
    mac: textOf(value.userMac),
    expireAt,
    serviceName: textOf(value.defaultServiceName),
    online: onlineRaw === true || textOf(onlineRaw) === '1' || textOf(onlineRaw) === 'true',
  };
}

/** 无感认证设备列表（query-user-mab-info，最多 100 条）。 */
export async function fetchPasspointDevices(): Promise<PasspointDevice[]> {
  const data = await request('/site/passpoint/query-user-mab-info?limit=100');
  const list = Array.isArray(data.data) ? data.data : [];
  return list.map(mapDevice);
}

export interface PasspointUser {
  readonly userId: string;
  readonly userName: string;
  readonly groupName: string;
  readonly accountState: number;
  readonly mobile: string;
  readonly email: string;
}

/** 校园网账户信息（query-user 的 d.queryUserResult.data）。 */
export async function fetchPasspointUser(): Promise<PasspointUser | null> {
  const data = await request('/site/passpoint/query-user');
  const result = isRecord(data.queryUserResult) ? data.queryUserResult : {};
  const profile = isRecord(result.data) ? result.data : null;
  if (!profile) return null;
  return {
    userId: textOf(profile.userId),
    userName: textOf(profile.userName),
    groupName: textOf(profile.userGroupName),
    accountState: Number(textOf(profile.accountState)) || 0,
    mobile: textOf(profile.mobile),
    email: textOf(profile.email),
  };
}

/** 新增无感设备：MAC 支持 `aa-bb-cc-dd-ee-ff` 或 `aa:bb:...`，服务端只认小写短横线。 */
export function normalizeMac(mac: string): string {
  const cleaned = mac
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  if (cleaned.length !== 12)
    throw new Error('MAC 地址格式不正确（应为 12 位十六进制，如 aa-bb-cc-dd-ee-ff）');
  return cleaned.match(/.{2}/g)!.join('-');
}

export async function addPasspointDevice(input: {
  mac: string;
  /** 0-365 天；0 表示最长有效期（6 年）。 */
  expireDays?: number;
  serviceName?: string;
}): Promise<void> {
  const days = input.expireDays ?? 0;
  if (!Number.isInteger(days) || days < 0 || days > 365)
    throw new Error('有效期必须是 0-365 的整数天（0 表示最长 6 年）');
  const body = new URLSearchParams({
    userMac: normalizeMac(input.mac),
    macExpireTime: String(days),
    defaultServiceName: input.serviceName ?? '',
  }).toString();
  await request('/site/passpoint/add-user-mab-info', { method: 'POST', body });
}

export async function cancelPasspointDevice(mac: string): Promise<void> {
  const body = new URLSearchParams({ userMac: normalizeMac(mac) }).toString();
  await request('/site/passpoint/cancel-user-mab-info', { method: 'POST', body });
}
