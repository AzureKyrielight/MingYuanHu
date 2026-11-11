/** 图书馆云打印（202.115.54.240）：复用统一认证 cookie 走 libic/CAS 登录取会话。
 *  token 与密码不会发往打印站；只读接口（Check / 任务列表）先落地，上传后续再接。 */
import { CampusAuthError } from '../campus';
import { scuRequest } from './client';
import { bindIdentitySession } from './identity';

const BASE = 'http://202.115.54.240';
const PAGE = `${BASE}/client/new/cprintPc/cprint.html`;
const JOBS_PAGE = `${BASE}/client/new/cprintPc/printDoc.html`;

const JSON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

/** 允许跟随的跳转来源：打印站、图书馆中继、统一认证。 */
const ALLOWED_ORIGINS = new Set([
  'http://202.115.54.240',
  'https://libic.scu.edu.cn',
  'https://id.scu.edu.cn',
]);

interface CloudPrintEnvelope {
  code?: unknown;
  message?: unknown;
  result?: unknown;
  SessionId?: unknown;
}

let ready = false;

export function resetCloudPrint(): void {
  ready = false;
}

function decode(response: Awaited<ReturnType<typeof scuRequest>>): CloudPrintEnvelope {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`云打印请求失败（HTTP ${response.status}）`);
  }
  return decodeCloudPrintBody(response.body);
}

/** 解析云打印 JSON 包层（纯函数，便于单测）。 */
export function decodeCloudPrintBody(body: string): CloudPrintEnvelope {
  let parsed: CloudPrintEnvelope;
  try {
    parsed = JSON.parse(body) as CloudPrintEnvelope;
  } catch {
    throw new Error('云打印返回了无法识别的数据');
  }
  if (typeof parsed.code !== 'number') throw new Error('云打印响应缺少有效的 code 字段');
  if (parsed.code === 4) {
    ready = false;
    throw new CampusAuthError('云打印会话已失效，请重新登录');
  }
  if (parsed.code !== 0) {
    const message =
      typeof parsed.message === 'string' && parsed.message ? parsed.message : '云打印请求失败';
    throw new Error(`${message}（code=${parsed.code}）`);
  }
  return parsed;
}

/** POST Auth/Check：成功时带 SessionId，说明云打印会话已建立。 */
async function check(): Promise<boolean> {
  const response = await scuRequest(`${BASE}/api/client/Auth/Check`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, Referer: PAGE },
    timeoutMs: 20_000,
  });
  const body = decode(response);
  return typeof body.SessionId === 'string' && body.SessionId.length > 0;
}

function allowOrigin(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('云打印返回了无法识别的登录链接');
  }
  if (!ALLOWED_ORIGINS.has(parsed.origin)) {
    throw new Error(`云打印登录链接来源不受信任：${parsed.origin}`);
  }
}

/** 预热云打印会话：已有会话直接复用，否则走 SSoPage → 图书馆认证 → 回跳。 */
export async function ensureCloudPrint(): Promise<void> {
  if (ready) return;
  await bindIdentitySession();
  if (
    await check().catch((error: unknown) => {
      if (error instanceof CampusAuthError) return false;
      throw error;
    })
  ) {
    ready = true;
    return;
  }
  const query = new URLSearchParams({ backurl: PAGE });
  const response = await scuRequest(`${BASE}/api/client/Auth/SSoPage?${query}`, {
    headers: JSON_HEADERS,
    timeoutMs: 20_000,
  });
  const body = decode(response);
  const loginUrl = typeof body.result === 'string' ? body.result : '';
  if (!loginUrl) throw new Error('云打印未返回登录链接');
  allowOrigin(loginUrl);
  const follow = await scuRequest(loginUrl, { headers: JSON_HEADERS, timeoutMs: 30_000 });
  if (follow.status < 200 || follow.status >= 300) {
    throw new Error(`图书馆认证回跳失败（HTTP ${follow.status}）`);
  }
  if (!(await check())) throw new CampusAuthError('云打印尚未建立登录会话，请重新登录');
  ready = true;
}

/** 只读：验证云打印会话可用（不产生任何打印任务）。 */
export async function fetchCloudPrintStatus(): Promise<{ ready: boolean }> {
  await ensureCloudPrint();
  return { ready: true };
}

/** 任务元数据白名单：账号、卡号、姓名与服务器路径不返回。 */
const JOB_KEYS = [
  'dwJobId',
  'dwOldJobId',
  'dwCreateDate',
  'dwCreateTime',
  'dwPrintDate',
  'dwPrintTime',
  'dwPages',
  'dwCopies',
  'dwStatus',
  'dwFee',
  'szAttribe',
  'szPaperDetail',
  'szJobName',
] as const;

/** 单条任务清洗（纯函数，便于单测）：白名单字段 + 纸张明细 JSON 解析。 */
export function mapCloudPrintJob(raw: unknown): Record<string, unknown> {
  const job: Record<string, unknown> = {};
  if (raw && typeof raw === 'object') {
    const source = raw as Record<string, unknown>;
    for (const key of JOB_KEYS) {
      if (key in source) job[key] = source[key];
    }
  }
  if (typeof job.szPaperDetail === 'string' && job.szPaperDetail) {
    try {
      job.szPaperDetail = JSON.parse(job.szPaperDetail) as unknown;
    } catch {
      // 解析失败时保留原始字符串，便于排查服务端格式变化。
    }
  }
  return job;
}

/** 只读：云打印任务列表（szPaperDetail 自动解析为 JSON）。 */
export async function fetchCloudPrintJobs(): Promise<unknown[]> {
  await ensureCloudPrint();
  const response = await scuRequest(`${BASE}/api/client/PrintJob/Get`, {
    headers: { ...JSON_HEADERS, Referer: JOBS_PAGE },
    timeoutMs: 20_000,
  });
  const body = decode(response);
  if (body.result === undefined) throw new Error('云打印任务列表缺少 result 字段');
  if (body.result === null) return [];
  if (!Array.isArray(body.result)) throw new Error('云打印任务列表 result 不是数组');
  return body.result.map(mapCloudPrintJob);
}
