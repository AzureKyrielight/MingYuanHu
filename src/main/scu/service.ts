/** 川大网上办事大厅（service.scu.edu.cn）：我的申请。 */
import { CampusAuthError } from '../campus';
import { bootstrapSso, parseJson, scuRequest } from './client';
import { bindIdentitySession } from './identity';

const SERVICE_BASE = 'https://service.scu.edu.cn';
const SERVICE_LOGIN = `${SERVICE_BASE}/api/login/main?redirect_url=${encodeURIComponent(
  `${SERVICE_BASE}/v2/matter/`,
)}`;

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
