/**
 * 川大智慧后勤在线报修（zhhq.scu.edu.cn）。
 *
 * 协议要点（移植自 SCU-CLI `internal/api/zhhq.go`）：
 * - 单点登录走 `scdxplugin_jwt31`，回跳带 userinfo，换 tokenKey；
 * - 每个业务请求的 `Token` 头是 `{tokenKey, clientId, timestamp, GUID}` 的
 *   AES-128-CBC（key=clientSecret，iv=clientId）密文；
 * - 响应体同样用固定 key/iv 加密，需先解密再解析 JSON。
 * clientId/clientSecret 是前端 JS 里的公开常量，不是用户凭据。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { CAMPUS_USER_AGENT, CampusAuthError } from '../campus';
import { describeResponse, scuDebug, scuRequest, type ScuResponse } from './client';
import { bindIdentitySession, ssoAuthorization } from './identity';
import { buildMultipart, contentTypeFor } from './multipart';

const BASE = 'https://zhhq.scu.edu.cn/api';
const CAS_URL = 'https://id.scu.edu.cn/enduser/sp/sso/scdxplugin_jwt31?enterpriseId=scdx';
const RESPONSE_KEY = '1974051005060708';
const RESPONSE_IV = '1974051005060708';
const CLIENT_ID = 'web201911chengdu';
const CLIENT_SECRET = 'bf8ec0449942e7f4';
const IMAGE_LIMIT = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif']);

let tokenKey = '';
let ready = false;

export function resetRepair(): void {
  tokenKey = '';
  ready = false;
}

function encrypt(plain: string, key: string, iv: string): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

function decrypt(cipherText: string): string {
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from(RESPONSE_KEY, 'utf8'),
    Buffer.from(RESPONSE_IV, 'utf8'),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText.trim(), 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** GUID 只影响签名的新鲜度，用 crypto 随机字节生成 v4 形态即可。 */
function guid(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 业务请求头 Token：AES({tokenKey, clientId, timestamp, GUID})。 */
export function buildRepairToken(key: string): string {
  return encrypt(
    JSON.stringify({
      tokenKey: key,
      clientId: CLIENT_ID,
      timestamp: Date.now(),
      GUID: guid(),
    }),
    CLIENT_SECRET,
    CLIENT_ID,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

interface ZhhqEnvelope extends Record<string, unknown> {
  status?: unknown;
  errorCode?: unknown;
  message?: unknown;
  data?: unknown;
}

function decodeEnvelope(body: string, status: number, service = '报修'): ZhhqEnvelope {
  if (status === 302 || status === 401 || status === 403 || !body.trim())
    throw new CampusAuthError('智慧后勤登录已失效，请重新连接统一身份认证');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypt(body)) as unknown;
  } catch {
    throw new Error(`${service}返回了无法识别的数据`);
  }
  if (!isRecord(parsed)) throw new Error(`${service}响应结构异常`);
  const code = Number(textOf(parsed.errorCode));
  if (Number.isFinite(code) && code >= 4010 && code <= 4017) {
    ready = false;
    tokenKey = '';
    throw new CampusAuthError(`${service}会话已失效，请重新登录`);
  }
  const statusText = textOf(parsed.status);
  const codeText = textOf(parsed.errorCode);
  if ((statusText && statusText !== 'success') || (codeText && codeText !== '0')) {
    throw new Error(textOf(parsed.message) || `${service}操作失败`);
  }
  return parsed as ZhhqEnvelope;
}

/** 静默登录：jwt31 回跳 → userinfo → login/auto → tokenKey。 */
async function login(): Promise<string> {
  await bindIdentitySession();
  const redirect = await scuRequest(CAS_URL, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,*/*',
      'User-Agent': CAMPUS_USER_AGENT,
      ...ssoAuthorization(),
    },
    timeoutMs: 30_000,
  });
  if (redirect.status === 401 || redirect.status === 403)
    throw new CampusAuthError('智慧后勤单点登录已失效');
  let userinfo = '';
  try {
    userinfo = new URL(redirect.url).searchParams.get('userinfo') ?? '';
  } catch {
    userinfo = '';
  }
  scuDebug('repair', `jwt31 ${describeResponse(redirect)} hasUserinfo=${userinfo !== ''}`);
  if (!userinfo) throw new CampusAuthError('智慧后勤认证回跳缺少 userinfo');

  const form = new URLSearchParams({
    userInfo: encodeURIComponent(userinfo),
    clientId: CLIENT_ID,
    timestamp: encrypt(String(Date.now()), RESPONSE_KEY, RESPONSE_IV),
    schoolCode: '10610',
    schoolName: '四川大学',
  });
  const response = await scuRequest(`${BASE}/auth/login/auto`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: 'https://zhhq.scu.edu.cn',
      Referer: 'https://zhhq.scu.edu.cn/account/login',
      'User-Agent': CAMPUS_USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: form.toString(),
    timeoutMs: 30_000,
  });
  const envelope = decodeEnvelope(response.body, response.status, '报修');
  const key = textOf(envelope.data);
  if (key.length < 16) throw new CampusAuthError('智慧后勤未返回有效的 tokenKey');
  ready = true;
  tokenKey = key;
  return key;
}

async function session(): Promise<string> {
  if (ready && tokenKey) return tokenKey;
  return login();
}

function headers(key: string, jsonBody: boolean): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': jsonBody
      ? 'application/json;charset=utf-8'
      : 'application/x-www-form-urlencoded; charset=UTF-8',
    Origin: 'https://zhhq.scu.edu.cn',
    Referer: 'https://zhhq.scu.edu.cn/ihome/newrepair',
    'User-Agent': CAMPUS_USER_AGENT,
    'X-Requested-With': 'XMLHttpRequest',
    Token: buildRepairToken(key),
    TokenKey: key,
  };
}

/** 统一请求 + 认证失效重试一次（重放只用于查询与幂等提交之外的场景）。 */
async function request(
  run: (key: string) => Promise<ScuResponse>,
  service = '报修',
): Promise<ZhhqEnvelope> {
  const key = await session();
  let response: ScuResponse;
  try {
    response = await run(key);
  } catch (error) {
    if (!(error instanceof CampusAuthError)) throw error;
    resetRepair();
    response = await run(await login());
  }
  return decodeEnvelope(response.body, response.status, service);
}

function postForm(path: string, form: Record<string, string> = {}): Promise<ZhhqEnvelope> {
  const body = new URLSearchParams(form).toString();
  return request((key) =>
    scuRequest(`${BASE}${path}`, {
      method: 'POST',
      headers: headers(key, false),
      body,
      timeoutMs: 20_000,
    }),
  );
}

function postJson(path: string, payload: unknown): Promise<ZhhqEnvelope> {
  return request((key) =>
    scuRequest(`${BASE}${path}`, {
      method: 'POST',
      headers: headers(key, true),
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
    }),
  );
}

const listOf = (envelope: ZhhqEnvelope): unknown[] =>
  Array.isArray(envelope.data) ? (envelope.data as unknown[]) : [];

const stringsOf = (envelope: ZhhqEnvelope): string[] =>
  listOf(envelope)
    .map((item) => textOf(item))
    .filter(Boolean);

export interface RepairAddress {
  readonly id: string;
  readonly areaId: string;
  readonly areaName: string;
  readonly addressDetail: string;
  readonly phone: string;
  readonly isCommon: boolean;
  readonly userId: string;
}

function mapAddress(raw: unknown): RepairAddress {
  const value = isRecord(raw) ? raw : {};
  return {
    id: textOf(value.id),
    areaId: textOf(value.areaId),
    areaName: textOf(value.areaName),
    addressDetail: textOf(value.addressDetail),
    phone: textOf(value.phone),
    isCommon: textOf(value.ifCommon) === '1',
    userId: textOf(value.createUser) || textOf(value.userId),
  };
}

export async function fetchRepairAddresses(): Promise<RepairAddress[]> {
  const envelope = await postForm('/repair/oneNetPublish/getCommonAddress');
  return listOf(envelope).map(mapAddress);
}

export interface RepairProject {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly children: readonly RepairProject[];
}

function mapProject(raw: unknown): RepairProject {
  const value = isRecord(raw) ? raw : {};
  // 服务端字段是 label（对齐 SCU-CLI），早期误读 name 会让项目名全空、提交被判缺少参数。
  return {
    id: textOf(value.id),
    name: textOf(value.label) || textOf(value.name),
    value: textOf(value.value) || textOf(value.id),
    children: Array.isArray(value.children) ? value.children.map(mapProject) : [],
  };
}

export async function fetchRepairProjects(areaId: string): Promise<RepairProject[]> {
  const envelope = await postForm('/repair/publish/getProjectByAreaId', { areaId });
  return listOf(envelope).map(mapProject);
}

/** 逐层查找叶子节点，返回叶子与「大类/项目」全名（提交时 projectName 用全名）。 */
export function findRepairProjectLeaf(
  nodes: readonly RepairProject[],
  value: string,
): { leaf: RepairProject; label: string } | null {
  const walk = (
    list: readonly RepairProject[],
    prefix: string,
  ): { leaf: RepairProject; label: string } | null => {
    for (const node of list) {
      const label = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.children.length > 0) {
        const found = walk(node.children, label);
        if (found) return found;
      } else if (node.value === value || node.id === value) {
        return { leaf: node, label };
      }
    }
    return null;
  };
  return walk(nodes, '');
}

export interface RepairAreaNode {
  readonly id: string;
  readonly name: string;
  readonly children: readonly RepairAreaNode[];
}

function mapArea(raw: unknown): RepairAreaNode {
  const value = isRecord(raw) ? raw : {};
  return {
    id: textOf(value.id),
    name: textOf(value.name),
    children: Array.isArray(value.children) ? value.children.map(mapArea) : [],
  };
}

export async function fetchRepairAreaTree(): Promise<RepairAreaNode[]> {
  const envelope = await postForm('/repair/publish/getAreaTree');
  return listOf(envelope).map(mapArea);
}

export async function fetchRepairBookDates(): Promise<string[]> {
  return stringsOf(await postForm('/repair/publish/getBookDate'));
}

export async function fetchRepairBookTimes(bookDate: string): Promise<string[]> {
  return stringsOf(await postForm('/repair/publish/getBookTime', { bookDate }));
}

export interface RepairTicket {
  readonly id: string;
  readonly status: string;
  readonly createTime: string;
  readonly content: string;
  readonly address: string;
}

function mapTicket(raw: unknown): RepairTicket {
  const value = isRecord(raw) ? raw : {};
  const content = value.content;
  const parsed = (() => {
    if (!isRecord(content)) return {};
    return content;
  })();
  return {
    // 列表行的 id 不是工单 id，撤回/详情要用 activeId（对齐 SCU-CLI）。
    id: textOf(value.activeId) || textOf(value.id),
    status: textOf(value.status) || textOf(value.flowStatus),
    createTime: textOf(value.createTime),
    content:
      textOf(value.contentText) ||
      textOf(parsed.text) ||
      (typeof content === 'string' ? content : ''),
    address: textOf(value.areaName) || textOf(value.address),
  };
}

/** 「我的动态」工单列表：按 createUser + systemCode=newRepair 过滤。 */
export async function fetchRepairTickets(userId: string): Promise<RepairTicket[]> {
  const search = JSON.stringify([
    { andOr: 'and', searchField: 'createUser', operator: '=', searchValue: userId },
    { andOr: 'and', searchField: 'systemCode', operator: '=', searchValue: 'newRepair' },
  ]);
  const envelope = await postForm('/manager/activeTemplateData/list', {
    search,
    order: 'createTime desc',
  });
  const data = envelope.data;
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.rows)
      ? data.rows
      : isRecord(data) && Array.isArray(data.list)
        ? data.list
        : [];
  return rows.map(mapTicket);
}

export async function withdrawRepair(id: string): Promise<void> {
  await postForm('/repair/myRepair/withdrawMyRepair', { id });
}

export interface RepairAcceptDept {
  readonly deptId: string;
  readonly deptName: string;
  readonly payName: string;
}

async function fetchAcceptDept(
  areaId: string,
  projectId: string,
): Promise<RepairAcceptDept | null> {
  const envelope = await postForm('/repair/publish/getAcceptUserByAreaIdAndProjectId', {
    areaId,
    projectId,
  });
  const data = envelope.data;
  if (!isRecord(data)) return null;
  const source = isRecord(data.dept)
    ? data.dept
    : Array.isArray(data.users) && isRecord(data.users[0])
      ? data.users[0]
      : null;
  if (!source) return null;
  return {
    deptId: textOf(source.deptId) || textOf(source.id),
    deptName: textOf(source.deptName) || textOf(source.name),
    payName: textOf(source.payName),
  };
}

/** 上传现场照片，返回服务端路径（resourcesVOS.fileUrl）。响应是明文 JSON。 */
export async function uploadRepairImage(filePath: string): Promise<string> {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error('图片不是普通文件');
  if (info.size > IMAGE_LIMIT) throw new Error('单张图片不能超过 10 MB');
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (!IMAGE_EXTENSIONS.has(extension))
    throw new Error('图片格式不支持（仅 jpg/jpeg/png/heic/heif）');
  const data = new Uint8Array(await readFile(filePath));
  const name = basename(filePath);
  const { body, contentType } = buildMultipart([
    { field: 'system', value: 'manager' },
    { field: 'file', filename: name, contentType: contentTypeFor(name), data },
  ]);
  const key = await session();
  const response = await scuRequest(`${BASE}/file/upload`, {
    method: 'POST',
    headers: { ...headers(key, false), 'Content-Type': contentType },
    body,
    timeoutMs: 120_000,
  });
  const trimmed = response.body.trim();
  if (!trimmed || response.status === 302 || response.status === 401 || response.status === 403)
    throw new CampusAuthError('智慧后勤会话已失效');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('图片上传失败：响应解析异常');
  }
  if (!isRecord(parsed)) throw new Error('图片上传失败：响应异常');
  const statusText = textOf(parsed.status);
  const codeText = textOf(parsed.errorCode);
  if ((statusText && statusText !== 'success') || (codeText && codeText !== '0'))
    throw new Error(textOf(parsed.message) || '图片上传失败');
  const path = isRecord(parsed.data) ? textOf(parsed.data.path) : '';
  if (!path) throw new Error('图片上传失败：未返回路径');
  return path;
}

export interface RepairSubmitInput {
  readonly addressId: string;
  /** 叶子节点 value（不是 name）。 */
  readonly projectId: string;
  readonly content: string;
  readonly bookDate?: string;
  readonly bookTime?: string;
  readonly allowAbsent?: boolean;
  /** 已由 pick 接口允许过的本地图片路径。 */
  readonly images?: readonly string[];
  readonly realname?: string;
}

export interface RepairSubmitResult {
  readonly submitted: true;
  readonly address: string;
  readonly project: string;
  readonly warnings: readonly string[];
}

/** 提交报修工单：地址 → 项目叶子 → 上传图片 → 预取负责部门 → publish。 */
export async function submitRepair(input: RepairSubmitInput): Promise<RepairSubmitResult> {
  if (!input.addressId) throw new Error('请选择报修地址');
  if (!input.projectId) throw new Error('请选择维修项目');
  const content = input.content.trim();
  if (!content) throw new Error('请填写故障描述');
  if (input.bookTime && !input.bookDate) throw new Error('选择预约时段时必须同时选择日期');
  if ((input.images?.length ?? 0) > 3) throw new Error('图片最多 3 张');

  const addresses = await fetchRepairAddresses();
  const address = addresses.find((item) => item.id === input.addressId);
  if (!address) throw new Error('报修地址不存在，请刷新后重试');

  const projects = await fetchRepairProjects(address.areaId);
  const found = findRepairProjectLeaf(projects, input.projectId);
  if (!found) throw new Error('维修项目不在该区域的列表中，请重新选择');

  const warnings: string[] = [];
  const resources: { fileUrl: string; fileType: string; statusType: string }[] = [];
  for (const image of input.images ?? []) {
    resources.push({ fileUrl: await uploadRepairImage(image), fileType: '1', statusType: '1' });
  }

  const dept = await fetchAcceptDept(address.areaId, found.leaf.value || found.leaf.id).catch(
    (error: unknown) => {
      warnings.push(
        `预取负责部门失败（不影响提交）：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    },
  );

  const payload: Record<string, unknown> = {
    type: '0',
    ifShielding: '1',
    areaName: address.areaName,
    address: address.addressDetail,
    projectName: found.label,
    bookDate: input.bookDate ?? '',
    bookTime: input.bookTime ?? '',
    repairUserName: input.realname ?? '',
    repairUserMobile: address.phone,
    repairDeptName: '',
    ifOnduty: input.allowAbsent ? '1' : '0',
    repairNum: 1,
    content,
    ifPublish: '1',
    ifUrgent: '0',
    id: '',
    resourcesVOS: resources,
    source: '1',
    projectId: found.leaf.value || found.leaf.id,
    areaId: address.areaId,
    ifRecord: 0,
  };
  if (dept) {
    payload.payName = dept.payName;
    payload.acceptDeptId = dept.deptId;
    payload.acceptDeptName = dept.deptName;
  } else {
    warnings.push('未取到负责部门信息，提交时服务端可能拒单');
  }

  await postJson('/repair/publish/publish', payload);
  return {
    submitted: true,
    address: `${address.areaName} ${address.addressDetail}`.trim(),
    project: found.label,
    warnings,
  };
}

export interface RepairEvaluateProject {
  readonly id: string;
  readonly name: string;
  readonly weight: string;
}

export async function fetchRepairEvaluateProjects(): Promise<RepairEvaluateProject[]> {
  const envelope = await postForm('/repair/commontProject/getProject');
  return listOf(envelope).map((item) => {
    const value = isRecord(item) ? item : {};
    return { id: textOf(value.id), name: textOf(value.name), weight: textOf(value.weight) };
  });
}

/** 评价工单：stars 是 评价项 id → 1..5 星，可用 `*` 作为统一星级。 */
export async function evaluateRepair(input: {
  repairId: string;
  stars: Record<string, number>;
  content?: string;
  labels?: readonly string[];
}): Promise<void> {
  const projects = await fetchRepairEvaluateProjects();
  const common = projects.map((project) => ({
    id: project.id,
    name: project.name,
    weight: project.weight,
    star: input.stars[project.id] ?? input.stars['*'] ?? 5,
  }));
  await postJson('/repair/visitEvaluateUser/save', {
    common,
    content: input.content ?? '',
    repairId: input.repairId,
    source: '0',
    label: (input.labels ?? []).join(','),
  });
}
