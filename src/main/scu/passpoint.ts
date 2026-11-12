/**
 * 校园网无感认证（智慧线上服务平台 service.scu.edu.cn/newservice）。
 *
 * 认证是 SSO 中继：`/newservice/api/login/cas?redirect_url=…m_passpoint`，
 * 成功后会话里带 process_uid。响应信封 e==="OK" 表示成功，
 * 具体业务结果在 d.errorCode（0 成功）。
 */
import { CampusAuthError } from '../campus';
import { bootstrapSso, scuRequest, type ScuResponse } from './client';
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
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

let ready = false;

export function resetPasspoint(): void {
  ready = false;
}

async function ensurePasspoint(): Promise<void> {
  if (ready) return;
  await bindIdentitySession();
  await bootstrapSso(LOGIN, '校园网服务');
  ready = true;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

/** 解析 newservice 信封并校验 d.errorCode（0 成功）。 */
export function decodePasspointBody(body: string, status: number): Record<string, unknown> {
  if (status === 302 || status === 401 || status === 403 || !body.trim())
    throw new CampusAuthError('校园网服务登录已失效');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
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

async function request(path: string, init: { method?: 'GET' | 'POST'; body?: string } = {}) {
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
  return decodePasspointBody(response.body, response.status);
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
