/** 川大体测系统（pead.scu.edu.cn）。 */
import { CampusAuthError } from '../campus';
import { bootstrapSso, parseJson, scuRequest } from './client';
import { bindIdentitySession } from './identity';

const FITNESS_BASE = 'https://pead.scu.edu.cn/bdlp_h5_fitness_test/public/index.php';
const FITNESS_LOGIN = `${FITNESS_BASE}/index/login/scuMsLogin`;

const FITNESS_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/x-www-form-urlencoded',
  Origin: 'https://pead.scu.edu.cn',
  Referer: `${FITNESS_BASE}/index/index`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest',
};

interface FitnessEnvelope {
  status?: unknown;
  info?: unknown;
  data?: unknown;
}

let fitnessReady = false;

export function resetFitness(): void {
  fitnessReady = false;
}

async function ensureFitness(): Promise<void> {
  if (fitnessReady) return;
  await bindIdentitySession();
  await bootstrapSso(FITNESS_LOGIN, '体测系统');
  fitnessReady = true;
}

function decode(response: Awaited<ReturnType<typeof scuRequest>>): FitnessEnvelope {
  const body = parseJson<FitnessEnvelope>(response, '体测系统');
  if (String(body.status) === '1') return body;
  const message = typeof body.info === 'string' && body.info ? body.info : '体测服务请求失败';
  if (message.includes('登录信息失效') || message.includes('请重新登录')) {
    fitnessReady = false;
    throw new CampusAuthError('体测系统登录已失效，请重新连接统一身份认证');
  }
  throw new Error(message);
}

export async function fetchFitnessNotices(): Promise<unknown> {
  await ensureFitness();
  const response = await scuRequest(`${FITNESS_BASE}/index/News/getSchoolNoticeList`, {
    method: 'POST',
    headers: FITNESS_HEADERS,
    body: new URLSearchParams().toString(),
  });
  const body = decode(response);
  return Array.isArray(body.data) ? body.data : [];
}

export async function fetchFitnessScore(year: number): Promise<unknown> {
  await ensureFitness();
  const response = await scuRequest(`${FITNESS_BASE}/index/Report/getStudentScore`, {
    method: 'POST',
    headers: FITNESS_HEADERS,
    body: new URLSearchParams({ year_num: String(year) }).toString(),
  });
  const body = decode(response);
  return body.data ?? null;
}
