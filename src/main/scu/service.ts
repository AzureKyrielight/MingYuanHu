/** 川大网上办事大厅（service.scu.edu.cn）：我的申请、动态表单、附件与提交。 */
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { CampusAuthError } from '../campus';
import { bootstrapSso, parseJson, scuRequest } from './client';
import { bindIdentitySession } from './identity';
import { buildMultipart, contentTypeFor } from './multipart';
import {
  buildServiceFormData,
  buildServiceSchema,
  defaultServiceValues,
  missingRequiredFields,
  parseFormDefinition,
  type ServiceAttachment,
  type ServiceSchema,
} from './service-form';

const SERVICE_BASE = 'https://service.scu.edu.cn';
const SERVICE_LOGIN = `${SERVICE_BASE}/api/login/main?redirect_url=${encodeURIComponent(
  `${SERVICE_BASE}/v2/matter/`,
)}`;
const DEFAULT_STARTER_DEPART_ID = '395876';
const ATTACHMENT_LIMIT = 100 * 1024 * 1024;

const SERVICE_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: SERVICE_BASE,
  Referer: SERVICE_BASE,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest',
};

interface ServiceEnvelope {
  e?: unknown;
  m?: unknown;
  d?: unknown;
}

const FORM_HEADERS = {
  ...SERVICE_HEADERS,
  'Content-Type': 'application/x-www-form-urlencoded',
};

let serviceReady = false;

export function resetService(): void {
  serviceReady = false;
}

async function ensureService(): Promise<void> {
  if (serviceReady) return;
  await bindIdentitySession();
  await bootstrapSso(SERVICE_LOGIN, '办事大厅');
  serviceReady = true;
}

function decode(response: Awaited<ReturnType<typeof scuRequest>>): ServiceEnvelope {
  const body = parseJson<ServiceEnvelope>(response, '办事大厅');
  if (body.e === 10042 || body.e === '10042') {
    serviceReady = false;
    throw new CampusAuthError('办事大厅登录已失效，请重新连接统一身份认证');
  }
  if (body.e !== 0 && body.e !== '0') {
    const message = typeof body.m === 'string' && body.m ? body.m : '办事大厅请求失败';
    throw new Error(message);
  }
  return body;
}

export async function fetchMyApplications(status = 0, page = 1): Promise<unknown> {
  await ensureService();
  const query = new URLSearchParams({
    p: String(page),
    page_size: '20',
    status: String(status),
    keyword: '',
    time_lower: '',
    time_upper: '',
    y: '',
    task_name: '',
  });
  const response = await scuRequest(`${SERVICE_BASE}/site/process/inst-list?${query}`, {
    headers: SERVICE_HEADERS,
  });
  const body = decode(response);
  const data: unknown = body.d;
  if (Array.isArray(data)) return data;
  const list = (data as { list?: unknown } | undefined)?.list;
  return Array.isArray(list) ? list : [];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

/** 发起部门：select==1 的候选项优先，其次第一项，兜底固定值。 */
export async function fetchStarterDepartId(appId: string): Promise<string> {
  const query = new URLSearchParams({ app_id: appId });
  const response = await scuRequest(`${SERVICE_BASE}/site/process/select-department?${query}`, {
    headers: FORM_HEADERS,
  });
  const data = decode(response).d;
  if (!isRecord(data)) return DEFAULT_STARTER_DEPART_ID;
  const departs = Array.isArray(data.depart) ? data.depart : [];
  const pick = (item: unknown): string => {
    if (!isRecord(item)) return '';
    for (const key of ['college', 'depart_id', 'department_id', 'value', 'id']) {
      const value = textOf(item[key]);
      if (value && value !== '0') return value;
    }
    return '';
  };
  for (const item of departs) {
    if (isRecord(item) && textOf(item.select) === '1') {
      const id = pick(item);
      if (id) return id;
    }
  }
  return pick(departs[0]) || DEFAULT_STARTER_DEPART_ID;
}

/** start-info：拿 bpmn_id（get-formv 的必填入参）。 */
async function fetchBpmnId(appId: string): Promise<string> {
  const query = new URLSearchParams({ app_id: appId });
  const response = await scuRequest(`${SERVICE_BASE}/site/process/start-info?${query}`, {
    headers: FORM_HEADERS,
  });
  const data = decode(response).d;
  if (!isRecord(data)) throw new Error('事项信息结构异常');
  const bpmnId = textOf(data.bpmn_id) || textOf(data.bpmnId);
  if (!bpmnId) throw new Error('事项信息缺少 bpmn_id');
  return bpmnId;
}

/** start-data：当前表单 id、字段权限（auth）与预填值（data）。 */
async function fetchStartData(
  appId: string,
  starterDepartId: string,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    app_id: appId,
    node_id: '',
    userview: '1',
    agent_uid: '',
    starter_depart_id: starterDepartId,
  });
  const response = await scuRequest(`${SERVICE_BASE}/site/process/start-data?${query}`, {
    headers: FORM_HEADERS,
  });
  const data = decode(response).d;
  if (!isRecord(data)) throw new Error('发起数据结构异常');
  return data;
}

/** get-formv：插件定义（plugins 为二次编码 JSON）。 */
async function fetchFormPlugins(
  formId: string,
  bpmnId: string,
  starterDepartId: string,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    id: formId,
    bpmn_id: bpmnId,
    sess_id: '0',
    report_id: '0',
    agent_uid: '',
    starter_depart_id: starterDepartId,
  });
  const response = await scuRequest(`${SERVICE_BASE}/site/form/get-formv?${query}`, {
    headers: FORM_HEADERS,
  });
  const data = decode(response).d;
  if (!isRecord(data)) throw new Error('表单定义结构异常');
  return data;
}

export interface ServiceFormView {
  readonly appId: string;
  readonly starterDepartId: string;
  readonly schema: ServiceSchema;
  /** 可直接放进表单的预填值。 */
  readonly values: Record<string, unknown>;
}

/** 读取事项的动态表单：先拿发起部门，再并行取 bpmn_id 与 start-data，最后合并插件定义。 */
export async function fetchServiceForm(appId: string): Promise<ServiceFormView> {
  await ensureService();
  const starterDepartId = await fetchStarterDepartId(appId);
  const [bpmnId, startData] = await Promise.all([
    fetchBpmnId(appId),
    fetchStartData(appId, starterDepartId),
  ]);
  const definition = parseFormDefinition(startData);
  if (!definition.formId) throw new Error('发起数据缺少表单 id（currform）');
  const formv = await fetchFormPlugins(definition.formId, bpmnId, starterDepartId);
  const schema = buildServiceSchema(appId, formv, definition);
  return { appId, starterDepartId, schema, values: defaultServiceValues(schema) };
}

/** 提交前的必填校验结果（交给渲染层标红）。 */
export function validateServiceValues(schema: ServiceSchema, values: Record<string, unknown>) {
  return missingRequiredFields(schema, values).map(({ key, label }) => ({
    key,
    label: label || key,
  }));
}

/** 提交事项（POST /site/process/launch，data 为 JSON 字符串）。 */
export async function submitServiceForm(
  appId: string,
  values: Record<string, unknown>,
): Promise<{ submitted: true }> {
  const form = await fetchServiceForm(appId);
  const missing = validateServiceValues(form.schema, values);
  if (missing.length > 0)
    throw new Error(`还有必填项未填写：${missing.map((item) => item.label).join('、')}`);
  const payload = JSON.stringify({
    app_id: appId,
    node_id: '',
    form_data: buildServiceFormData(form.schema, values),
    userview: 1,
  });
  const body = new URLSearchParams({
    data: payload,
    step: '0',
    agent_uid: '',
    starter_depart_id: form.starterDepartId,
  });
  const response = await scuRequest(`${SERVICE_BASE}/site/process/launch`, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: body.toString(),
    timeoutMs: 30_000,
  });
  decode(response);
  return { submitted: true };
}

/** 上传单个附件（multipart 字段 upfile），返回表单可直接使用的 {name,url,id}。 */
export async function uploadServiceAttachment(
  appId: string,
  filePath: string,
): Promise<ServiceAttachment> {
  await ensureService();
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('附件不是普通文件');
  if (info.size > ATTACHMENT_LIMIT) throw new Error('附件超过 100 MB 上限');
  const data = new Uint8Array(await readFile(filePath));
  const name = basename(filePath);
  const { body, contentType } = buildMultipart([
    { field: 'upfile', filename: name, contentType: contentTypeFor(name), data },
  ]);
  const response = await scuRequest(`${SERVICE_BASE}/site/attach/auth-upload`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': contentType,
      Origin: SERVICE_BASE,
      Referer: `${SERVICE_BASE}/v2/matter/start?id=${encodeURIComponent(appId)}`,
      'User-Agent': SERVICE_HEADERS['User-Agent'],
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
    timeoutMs: 120_000,
  });
  const trimmed = response.body.trim();
  if (!trimmed || (trimmed.startsWith('<') && trimmed.includes('login')))
    throw new CampusAuthError('办事大厅登录已失效');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('附件上传返回了无法识别的数据');
  }
  // 该端点响应没有 e 字段：{url,size,title,original,state,type,id}。
  const result = isRecord(parsed) ? parsed : {};
  const id = textOf(result.id);
  const url = textOf(result.url);
  const state = textOf(result.state);
  if ((!url && state !== 'SUCCESS') || !id) {
    const message = textOf(result.message) || textOf(result.msg);
    throw new Error(message || '附件上传失败');
  }
  return {
    name: textOf(result.original) || name,
    url: `${SERVICE_BASE}/site/attach/auth-download?file_id=${encodeURIComponent(id)}`,
    id,
  };
}
