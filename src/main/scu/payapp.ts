/** 川大缴费平台（payapp.scu.edu.cn）：校区/楼栋/单元与电费余额。 */
import type { ScuCodeName } from '../../shared/scu';
import { CampusAuthError } from '../campus';
import { bootstrapSso, parseJson, scuRequest } from './client';
import { ensureWfw } from './wfw';

const PAY_BASE = 'https://payapp.scu.edu.cn/eleFees';

const PAY_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json;charset=UTF-8',
  Origin: 'https://payapp.scu.edu.cn',
  Referer: 'https://payapp.scu.edu.cn',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

let payReady = false;

export function resetPayApp(): void {
  payReady = false;
}

export async function ensurePayApp(): Promise<void> {
  if (payReady) return;
  await ensureWfw();
  await bootstrapSso(`${PAY_BASE}/oauth/airWarrant`, '缴费平台');
  payReady = true;
}

interface PayEnvelope {
  respCode?: unknown;
  respDesc?: unknown;
  data?: unknown;
}

async function post(path: string, payload: Record<string, unknown>): Promise<PayEnvelope> {
  await ensurePayApp();
  const response = await scuRequest(`${PAY_BASE}${path}`, {
    method: 'POST',
    headers: PAY_HEADERS,
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
  });
  const htmlLogin =
    response.body.trimStart().startsWith('<') &&
    (response.body.includes('登录超时') || response.body.includes('oauth/'));
  if (htmlLogin) {
    payReady = false;
    throw new CampusAuthError('缴费平台登录已失效，请重新连接统一身份认证');
  }
  if (response.status === 401 || response.status === 403) {
    payReady = false;
    throw new CampusAuthError('缴费平台登录已失效，请重新连接统一身份认证');
  }
  const body = parseJson<PayEnvelope>(response, '缴费平台');
  if (body.respCode !== '00') {
    const message =
      typeof body.respDesc === 'string' && body.respDesc ? body.respDesc : '缴费平台请求失败';
    throw new Error(message);
  }
  return body;
}

function datas(body: PayEnvelope): Record<string, unknown>[] {
  const data = body.data as { datas?: unknown } | undefined;
  return Array.isArray(data?.datas)
    ? data.datas.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
      )
    : [];
}

function firstString(item: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function toCodeName(item: Record<string, unknown>): ScuCodeName {
  return {
    name: firstString(item, ['name', 'schoolName', 'regName', 'unitName', 'buildingName', 'label']),
    code: firstString(item, ['code', 'schoolCode', 'regCode', 'unitCode', 'value', 'id']),
  };
}

export async function fetchCampus(): Promise<ScuCodeName[]> {
  return datas(await post('/electric/getCampus', {})).map(toCodeName);
}

export async function fetchBuildings(schoolCode: string): Promise<ScuCodeName[]> {
  return datas(await post('/electric/getArchitecture', { schoolCode })).map(toCodeName);
}

export async function fetchUnits(schoolCode: string, regCode: string): Promise<ScuCodeName[]> {
  return datas(await post('/electric/getUnit', { schoolCode, regCode })).map(toCodeName);
}

export async function verifyRoom(input: {
  cusNo: string;
  type: 1 | 2;
  cusName: string;
  schoolCode: string;
  regCode: string;
  unitCode: string;
  roomNo: string;
}): Promise<boolean> {
  const body = await post('/electric/verificationRoom', input);
  const data = body.data as { status?: unknown } | undefined;
  return data?.status === true;
}

export async function queryRoomInfo(cusNo: string, type: 1 | 2, cusName: string): Promise<unknown> {
  const body = await post('/electric/queryRoomInfo', { cusNo, type, cusName });
  if (typeof body.data !== 'object' || body.data === null) throw new Error('查询数据为空');
  return body.data;
}
