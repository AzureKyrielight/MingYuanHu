/** 图书馆云打印（202.115.54.240）：复用统一认证 cookie 走 libic/CAS 登录取会话。
 *  token 与密码不会发往打印站；支持会话检查、任务列表与文件上传。 */
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { CampusAuthError } from '../campus';
import { scuRequest } from './client';
import { bindIdentitySession } from './identity';
import { buildMultipart, contentTypeFor } from './multipart';

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

// ─── 上传 ────────────────────────────────────────────────────────

export interface CloudPrintOptions {
  /** bw（黑白）或 color（彩色）。 */
  readonly color: 'bw' | 'color';
  /** A4 / A3 / 原稿尺寸。 */
  readonly paper: 'a4' | 'a3' | 'original';
  /** 单面 / 长边翻页 / 短边翻页。 */
  readonly duplex: 'simplex' | 'long-edge' | 'short-edge';
  readonly copies: number;
  /** 'all'、单页 '3' 或连续范围 '2-5'。 */
  readonly pages: string;
}

export interface CloudPrintSettings {
  readonly options: CloudPrintOptions;
  /** 已翻译成打印站协议值的字段。 */
  readonly fields: Readonly<Record<string, string>>;
}

const COLOR_CODES: Record<string, string> = { bw: '1', color: '2' };
const PAPER_CODES: Record<string, string> = { a4: '9', a3: '8', original: '-1' };
const DUPLEX_CODES: Record<string, string> = { simplex: '1', 'long-edge': '2', 'short-edge': '3' };

/** 校验设置并转成协议字段（纯函数，便于单测）。 */
export function prepareCloudPrintOptions(options: CloudPrintOptions): CloudPrintSettings {
  const color = COLOR_CODES[options.color];
  const paper = PAPER_CODES[options.paper];
  const duplex = DUPLEX_CODES[options.duplex];
  if (!color) throw new Error('颜色只能是 bw 或 color');
  if (!paper) throw new Error('纸张只能是 a4、a3 或 original');
  if (!duplex) throw new Error('双面只能是 simplex、long-edge 或 short-edge');
  if (!Number.isInteger(options.copies) || options.copies < 1 || options.copies > 999)
    throw new Error('份数必须是 1-999 的整数');
  let from = '0';
  let to = '0';
  if (options.pages.trim() !== 'all') {
    const match = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(options.pages.trim());
    if (!match) throw new Error('页码只能是 all、单页（如 3）或连续范围（如 2-5）');
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1) throw new Error('起始页必须从 1 开始');
    if (last < first) throw new Error('结束页不能小于起始页');
    from = String(first);
    to = String(last);
  }
  return {
    options,
    fields: {
      dwColor: color,
      dwPaperId: paper,
      dwDuplex: duplex,
      dwCopies: String(options.copies),
      dwFrom: from,
      dwTo: to,
    },
  };
}

/** 允许的上传格式（与打印站前端一致）。 */
export const CLOUD_PRINT_EXTENSIONS = new Set(
  'jpg jpeg heic png pdf txt doc xls docx xlsx ppt pptx wps wpt dot rtf dotx docm dotm xml mht mhtml html htm xps odt xlsm xlsb csv xltx xltm xlt prn dif slk xla xlam ods dps dpt pot pps pptm potm ppsm'.split(
    ' ',
  ),
);

export interface CloudPrintUploadResult {
  readonly status: 'uploaded';
  readonly fileName: string;
  /** 打印费用（元），服务端未返回时为空串。 */
  readonly fee: string;
  /** 上传后新增且同名的任务（正常应为 1 条）。 */
  readonly jobs: readonly unknown[];
  readonly verification: 'matched_new_job' | 'candidate_new_job' | 'ambiguous' | 'pending';
  readonly message: string;
  readonly warning?: string;
}

const jobIdOf = (job: unknown): string => {
  if (!job || typeof job !== 'object') return '';
  const value = (job as Record<string, unknown>).dwJobId;
  return value === null || value === undefined ? '' : String(value);
};

const jobNameOf = (job: unknown): string => {
  if (!job || typeof job !== 'object') return '';
  const value = (job as Record<string, unknown>).szJobName;
  return typeof value === 'string' ? value : '';
};

/** 只按任务 ID 做前后差集：长文件名会被服务端截断，不能按名字判断「新增」。 */
export function newCloudPrintJobs(
  before: readonly unknown[],
  after: readonly unknown[],
): unknown[] {
  const known = new Set(before.map(jobIdOf).filter(Boolean));
  return after.filter((job) => {
    const id = jobIdOf(job);
    return id !== '' && !known.has(id);
  });
}

/** 上传文件到云打印：提交后任务列表核对，失败不自动重发（避免重复打印）。 */
export async function uploadCloudPrint(
  filePath: string,
  options: CloudPrintOptions,
): Promise<CloudPrintUploadResult> {
  const settings = prepareCloudPrintOptions(options);
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('选择的不是普通文件');
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (!CLOUD_PRINT_EXTENSIONS.has(extension)) throw new Error('该文件格式不支持云打印');
  await ensureCloudPrint();

  const before = await fetchCloudPrintJobs();
  const name = basename(filePath);
  const data = new Uint8Array(await readFile(filePath));
  const { body, contentType } = buildMultipart([
    ...Object.entries(settings.fields).map(([field, value]) => ({ field, value })),
    { field: 'BackURL', value: `${JOBS_PAGE}?t=${Date.now()}` },
    { field: 'szPath', filename: name, contentType: contentTypeFor(name), data },
  ]);

  let response: Awaited<ReturnType<typeof scuRequest>>;
  try {
    response = await scuRequest(`${BASE}/api/client/CloudPrint/Upload`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Origin: BASE, Referer: PAGE },
      body,
      timeoutMs: 180_000,
    });
  } catch (error) {
    throw new Error(
      `文件上传请求失败，服务器是否已接收未知；请到任务列表核对后再决定是否重传（${
        error instanceof Error ? error.message : String(error)
      }）`,
    );
  }

  if (response.status === 413) throw new Error('云打印服务器拒绝文件（HTTP 413，文件过大）');
  if (response.status !== 200) throw new Error(`上传响应异常（HTTP ${response.status}）`);
  let code: number | null = null;
  let fee = '';
  try {
    const url = new URL(response.url);
    const raw = url.searchParams.get('code');
    code = raw === null ? null : Number(raw);
    fee = url.searchParams.get('fee') ?? '';
  } catch {
    code = null;
  }
  if (code === null || Number.isNaN(code)) throw new Error('上传响应缺少 code 参数');
  if (code !== 0) {
    if (code === 4) throw new CampusAuthError('云打印会话已失效，上传结果未知，请先核对任务列表');
    throw new Error(`云打印上传失败（code=${code}）`);
  }

  const result: CloudPrintUploadResult = {
    status: 'uploaded',
    fileName: name,
    fee,
    jobs: [],
    verification: 'pending',
    message: '文件已上传到云打印系统；到馆内终端刷校园卡确认打印',
  };

  let candidates: unknown[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300));
    let after: unknown[];
    try {
      after = await fetchCloudPrintJobs();
    } catch {
      return {
        ...result,
        jobs: candidates,
        verification: 'candidate_new_job',
        warning: '上传成功，但任务列表核对失败；请稍后在任务列表确认，不要直接重复上传',
      };
    }
    const added = newCloudPrintJobs(before, after);
    for (const job of added) {
      if (!candidates.some((item) => jobIdOf(item) === jobIdOf(job))) candidates.push(job);
    }
    const sameName = added.filter((job) => jobNameOf(job) === name);
    if (sameName.length === 1)
      return { ...result, jobs: sameName, verification: 'matched_new_job' };
    if (sameName.length > 1)
      return {
        ...result,
        jobs: sameName,
        verification: 'ambiguous',
        warning: '上传已确认，但出现多个同名新任务，请核对任务 ID，不要重复上传',
      };
  }
  if (candidates.length > 0)
    return {
      ...result,
      jobs: candidates,
      verification: 'candidate_new_job',
      warning: '上传已确认，但任务名与服务端记录不一致，请按任务 ID 核对',
    };
  return { ...result, verification: 'pending' };
}
