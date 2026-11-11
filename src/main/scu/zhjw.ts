/** 川大教务系统（zhjw.scu.edu.cn，仅 HTTP）协议移植自 SCU-CLI。 */
import type { ScuExam, ScuSemester } from '../../shared/scu';
import { CampusAuthError } from '../campus';
import { assertAuthenticated, parseJson, scuRequest } from './client';
export { currentPlanCode, isPlanCode, parseScheduleCourses } from './schedule';
export type { ParsedSchedule, ScuScheduleLesson } from './schedule';

export const ZHJW_BASE = 'http://zhjw.scu.edu.cn';

const ZHTML_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: `${ZHJW_BASE}/`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const ZAJAX_HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  Referer: `${ZHJW_BASE}/student/courseSelect/calendarSemesterCurriculum/index`,
  'User-Agent': ZHTML_HEADERS['User-Agent'],
  'X-Requested-With': 'XMLHttpRequest',
};

const OPTION_PATTERN = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const WEEK_PATTERN = /第(\d+)周/;

function stripHtml(value: string): string {
  return value.replace(HTML_TAG_PATTERN, '').trim();
}

/** 当前教学周；假期返回 week=0。 */
export async function fetchCurrentWeek(): Promise<{ week: number; onVacation: boolean }> {
  const response = await scuRequest(`${ZHJW_BASE}/`, { headers: ZHTML_HEADERS });
  assertAuthenticated(response, '教务系统');
  const match = WEEK_PATTERN.exec(response.body);
  if (match) return { week: Number(match[1]), onVacation: false };
  if (response.body.includes('当前处于假期时间')) return { week: 0, onVacation: true };
  throw new Error('无法获取当前教学周，请检查教务系统状态');
}

/** 学期列表；value 即课表所需的 planCode。 */
export async function fetchSemesters(): Promise<ScuSemester[]> {
  const response = await scuRequest(
    `${ZHJW_BASE}/student/courseSelect/calendarSemesterCurriculum/index`,
    { headers: ZHTML_HEADERS },
  );
  assertAuthenticated(response, '教务系统');
  const semesters: ScuSemester[] = [];
  for (const match of response.body.matchAll(OPTION_PATTERN)) {
    const value = match[1]?.trim() ?? '';
    if (!value) continue;
    semesters.push({ value, label: stripHtml(match[2] ?? '') });
  }
  if (semesters.length === 0) throw new Error('无法获取学期列表，请检查登录状态');
  return semesters;
}

/** 指定学期的课表原始 JSON（结构见 parseScheduleCourses）。 */
export async function fetchSchedule(planCode: string): Promise<unknown> {
  const response = await scuRequest(
    `${ZHJW_BASE}/student/courseSelect/thisSemesterCurriculum/ajaxStudentSchedule/callback`,
    {
      method: 'POST',
      headers: ZAJAX_HEADERS,
      body: new URLSearchParams({ planCode }).toString(),
    },
  );
  assertAuthenticated(response, '课表');
  if (!response.body.trim()) throw new CampusAuthError('课表接口返回了空数据，请重新登录后再试');
  return parseJson<unknown>(response, '课表');
}

/** 及格成绩 / 方案成绩（教务页面先给 callback 路径，再取 JSON）。 */
export async function fetchGrades(scheme = false): Promise<unknown> {
  const kind = scheme ? 'schemeScores' : 'allPassingScores';
  const indexPath = `${ZHJW_BASE}/student/integratedQuery/scoreQuery/${kind}/index`;
  const index = await scuRequest(indexPath, { headers: ZHTML_HEADERS });
  assertAuthenticated(index, '成绩查询');
  const callback = new RegExp(
    `var\\s+url\\s*=\\s*"(/student/integratedQuery/scoreQuery/[^/]+/${kind}/callback)"`,
  ).exec(index.body);
  if (!callback) {
    if (/login/i.test(index.body)) throw new CampusAuthError('教务 session 已过期，请重新登录');
    throw new Error(`无法从页面提取 ${kind} callback URL`);
  }
  const response = await scuRequest(`${ZHJW_BASE}${callback[1]}`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Referer: indexPath,
      'User-Agent': ZHTML_HEADERS['User-Agent'],
    },
  });
  assertAuthenticated(response, '成绩查询');
  return parseJson<unknown>(response, '成绩查询');
}

const EXAM_BLOCK_PATTERN =
  /<div class="widget-box widget-color-\w+(?: collapsed)?">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/g;
const EXAM_TITLE_PATTERN = /<h5 class="widget-title smaller">\s*([\s\S]*?)\s*<\/h5>/;
const EXAM_WEEK_PATTERN = /(\d+)周/;
const EXAM_DATE_PATTERN = /(\d{4}-\d{2}-\d{2})\s*&nbsp;/;
const EXAM_WEEKDAY_PATTERN = /(星期[一二三四五六日])/;
const EXAM_TIME_PATTERN = /&nbsp;(\d{2}:\d{2}-\d{2}:\d{2})/;
const EXAM_LOCATION_PATTERN = /地点:&nbsp;([\s\S]+?)<\/br>/;
const EXAM_SEAT_PATTERN = /座位号:&nbsp;(\d+)/;
const EXAM_TICKET_PATTERN = /准考证号:&nbsp;([\s\S]*?)<\/br>/;
const EXAM_TIP_PATTERN = /考试提示信息：&nbsp;([\s\S]*?)<\/span>/;
const EXAM_ENDED_PATTERN = /\s*（已结束）/;

function firstGroup(pattern: RegExp, value: string): string {
  return (pattern.exec(value)?.[1] ?? '').trim();
}

/** 考表（教务 HTML 卡片解析）。 */
export async function fetchExams(): Promise<ScuExam[]> {
  const response = await scuRequest(`${ZHJW_BASE}/student/examinationManagement/examPlan/index`, {
    headers: ZHTML_HEADERS,
  });
  assertAuthenticated(response, '考表');
  const exams: ScuExam[] = [];
  for (const block of response.body.matchAll(EXAM_BLOCK_PATTERN)) {
    const body = block[1] ?? '';
    const name = stripHtml(firstGroup(EXAM_TITLE_PATTERN, body)).replace(EXAM_ENDED_PATTERN, '');
    const week = firstGroup(EXAM_WEEK_PATTERN, body);
    exams.push({
      courseName: name || '未知',
      week: week ? `第 ${week} 周` : '未知',
      date: firstGroup(EXAM_DATE_PATTERN, body) || '未知',
      weekday: firstGroup(EXAM_WEEKDAY_PATTERN, body) || '未知',
      timeRange: firstGroup(EXAM_TIME_PATTERN, body) || '未知',
      location: firstGroup(EXAM_LOCATION_PATTERN, body).replaceAll('&nbsp;', ' ') || '未知',
      seatNumber: firstGroup(EXAM_SEAT_PATTERN, body) || '未知',
      ticketNumber: firstGroup(EXAM_TICKET_PATTERN, body),
      tip: firstGroup(EXAM_TIP_PATTERN, body) || '无',
    });
  }
  return exams;
}
