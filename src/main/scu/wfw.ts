/** 川大微服务（wfw.scu.edu.cn）：用户信息、校园卡交易。 */
import type { ScuCardHistory, ScuCardTransaction } from '../../shared/scu';
import { CampusAuthError } from '../campus';
import { assertAuthenticated, parseJson, retryOnAuth, scuRequest } from './client';
import { bindIdentitySession } from './identity';

const WFW_BASE = 'https://wfw.scu.edu.cn';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const WFW_JSON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': USER_AGENT,
  'X-Requested-With': 'XMLHttpRequest',
  Referer: WFW_BASE,
};

function isAuthCode(value: unknown): boolean {
  return value === 10013 || value === '10013';
}

function isSuccess(value: unknown): boolean {
  return value === 0 || value === '0';
}

interface WfwEnvelope {
  e?: unknown;
  m?: unknown;
  d?: unknown;
}

function decodeWfw(response: Awaited<ReturnType<typeof scuRequest>>, service: string): WfwEnvelope {
  assertAuthenticated(response, service);
  const body = parseJson<WfwEnvelope>(response, service);
  if (isAuthCode(body.e)) {
    wfwReady = false;
    throw new CampusAuthError('微服务登录已失效，请重新连接统一身份认证');
  }
  if (!isSuccess(body.e)) {
    const message = typeof body.m === 'string' && body.m ? body.m : `${service}请求失败`;
    throw new Error(message);
  }
  return body;
}

/** 微服务会话是否已预热；登录失效或断开连接时清除。 */
let wfwReady = false;

export function resetWfw(): void {
  wfwReady = false;
}

/** 预热微服务会话；匿名访问时跟随 CAS 链建立绑定用户的 cookie。 */
export async function ensureWfw(): Promise<void> {
  if (wfwReady) return;
  // 密码登录只给了 token；微服务的 CAS 链走 cookie，必须先绑定 session。
  await bindIdentitySession();
  const response = await scuRequest(`${WFW_BASE}/uc/wap/user/get-info`, {
    headers: { 'User-Agent': USER_AGENT },
    timeoutMs: 30_000,
  });
  decodeWfw(response, '微服务');
  wfwReady = true;
}

export interface ScuIdentity {
  readonly principal: string | null;
  readonly name: string | null;
}

export function identityOf(profile: unknown): ScuIdentity {
  const value = profile as { realname?: unknown; role?: { number?: unknown } } | null;
  return {
    name: typeof value?.realname === 'string' ? value.realname : null,
    principal: typeof value?.role?.number === 'string' ? value.role.number : null,
  };
}

/** 用户基本信息（d.base）。 */
export async function fetchUserProfile(): Promise<unknown> {
  return retryOnAuth(async () => {
    await ensureWfw();
    const response = await scuRequest(`${WFW_BASE}/uc/wap/user/get-info`, {
      headers: WFW_JSON_HEADERS,
      timeoutMs: 30_000,
    });
    const body = decodeWfw(response, '用户信息');
    const data = body.d as { base?: unknown } | undefined;
    return data?.base ?? null;
  }, resetWfw);
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 校园卡扣费/充值明细（cardhis 轻应用）。 */
export async function fetchCardHistory(sdate = '', edate = ''): Promise<ScuCardHistory> {
  return retryOnAuth(async () => {
    await ensureWfw();
    return loadCardHistory(sdate, edate);
  }, resetWfw);
}

async function loadCardHistory(sdate: string, edate: string): Promise<ScuCardHistory> {
  const response = await scuRequest(`${WFW_BASE}/cardhis/wap/default/get-index`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: WFW_BASE,
    },
    body: new URLSearchParams({ sdate, edate }).toString(),
  });
  const body = decodeWfw(response, '校园卡交易');
  const data = body.d as { list?: unknown } | undefined;
  const list = data?.list;
  if (typeof list !== 'object' || list === null) throw new Error('校园卡交易响应缺少明细');
  const transactions: ScuCardTransaction[] = [];
  const byDay: Record<string, number> = {};
  let totalCost = 0;
  for (const [day, rows] of Object.entries(list as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const item = row as Record<string, unknown>;
      const transaction: ScuCardTransaction = {
        toname: asString(item.toname),
        jdate: Math.trunc(asNumber(item.jdate)),
        xfje: asNumber(item.xfje),
        syje: asNumber(item.syje),
        type: asString(item.type),
        time: asString(item.time),
        day,
      };
      transactions.push(transaction);
      if (transaction.type === '消费') {
        byDay[day] = (byDay[day] ?? 0) + transaction.xfje;
        totalCost += transaction.xfje;
      }
    }
  }
  transactions.sort((a, b) => a.jdate - b.jdate);
  const last = transactions.at(-1);
  return {
    transactions,
    byDay,
    totalCost,
    txnCount: transactions.length,
    balance: last ? last.syje : null,
    balanceAsOf: last ? new Date(last.jdate * 1000).toISOString() : '',
  };
}
