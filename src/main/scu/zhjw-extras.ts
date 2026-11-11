/** 川大教务扩展查询：空闲教室、培养方案与学分完成、班级课表、课程课表。
 *  协议与解析规则移植自 SCU-CLI（internal/api/zhjw.go）。 */
import { assertAuthenticated, retryOnAuth, scuRequest } from './client';

const ZHJW_BASE = 'http://zhjw.scu.edu.cn';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ZHTML_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: `${ZHJW_BASE}/`,
  'User-Agent': USER_AGENT,
};

const ZAJAX_HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  Referer: `${ZHJW_BASE}/student/courseSelect/calendarSemesterCurriculum/index`,
  'User-Agent': USER_AGENT,
  'X-Requested-With': 'XMLHttpRequest',
};

const FORM_HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'User-Agent': USER_AGENT,
  'X-Requested-With': 'XMLHttpRequest',
};

/** 教务会话失效时重试一次；Cookie 会话共用校园分区，无需额外失效缓存。 */
function withZhjw<T>(run: () => Promise<T>): Promise<T> {
  return retryOnAuth(run, () => {});
}

async function getHtml(
  path: string,
  service: string,
  headers: Record<string, string> = ZHTML_HEADERS,
): Promise<string> {
  const response = await scuRequest(`${ZHJW_BASE}${path}`, { headers, timeoutMs: 30_000 });
  assertAuthenticated(response, service);
  return response.body;
}

async function postForm(
  path: string,
  form: Record<string, string>,
  service: string,
  headers: Record<string, string> = FORM_HEADERS,
): Promise<string> {
  const response = await scuRequest(`${ZHJW_BASE}${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(form).toString(),
    timeoutMs: 30_000,
  });
  assertAuthenticated(response, service);
  return response.body;
}

function json<T>(body: string, service: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${service}返回了无法识别的数据`);
  }
}

// ─── HTML 解析 ──────────────────────────────────────────────────

const SELECT_PATTERN = /<select[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g;
const OPTION_PATTERN = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g;
const TAG_PATTERN = /<[^>]+>/g;

function stripTags(value: string): string {
  return value
    .replace(TAG_PATTERN, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export interface ScuOption {
  readonly value: string;
  readonly label: string;
}

function selectOptions(body: string, name: string): ScuOption[] {
  for (const match of body.matchAll(SELECT_PATTERN)) {
    if (match[1] !== name) continue;
    const options: ScuOption[] = [];
    for (const option of (match[2] ?? '').matchAll(OPTION_PATTERN)) {
      const value = option[1]?.trim() ?? '';
      if (!value) continue;
      options.push({ value, label: stripTags(option[2] ?? '') });
    }
    return options;
  }
  return [];
}

/** 隐藏 input 里的 JSON 数组（校区/教学楼/教室类型都在这里下发）。 */
function hiddenJson(body: string, id: string): string | null {
  const pattern = new RegExp(`<input[^>]+id="${id}"[^>]+value='([^']+)'`);
  return pattern.exec(body)?.[1] ?? null;
}

function hiddenArray(body: string, id: string, service: string): unknown[] {
  const raw = hiddenJson(body, id);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch {
    throw new Error(`${service}返回了无法识别的数据`);
  }
}

// ─── 空闲教室 ───────────────────────────────────────────────────

export async function fetchClassroomIndex(): Promise<{
  campuses: unknown[];
  buildings: unknown[];
}> {
  return withZhjw(async () => {
    const body = await getHtml('/student/teachingResources/classroomUseStatus/index', '教室查询');
    return {
      campuses: hiddenArray(body, 'xqList', '教室查询'),
      buildings: hiddenArray(body, 'jxlList', '教室查询'),
    };
  });
}

export async function fetchClassroomTypes(input: {
  campusNumber: string;
  buildingNumber: string;
  campusName: string;
  buildingName: string;
}): Promise<unknown[]> {
  const path =
    `/student/teachingResources/classroomUseStatus/${input.campusNumber}/${input.buildingNumber}` +
    `/${encodeURIComponent(input.campusName)}/${encodeURIComponent(input.buildingName)}`;
  return withZhjw(async () => {
    const body = await getHtml(path, '教室类型');
    return hiddenArray(body, 'classroomTypes', '教室类型');
  });
}

export async function fetchClassroomAvailability(input: {
  campusNumber: string;
  buildingNumber: string;
  classroomType: string;
  classroomName: string;
  seatFrom: string;
  seatTo: string;
  date: string;
}): Promise<unknown> {
  return withZhjw(async () => {
    const body = await postForm(
      '/student/teachingResources/classroomUseStatus/jasInfo',
      {
        xqh: input.campusNumber,
        jxlh: input.buildingNumber,
        jslx: input.classroomType,
        jasm: input.classroomName,
        zwFrom: input.seatFrom,
        zwTo: input.seatTo,
        searchDate: input.date,
      },
      '教室占用',
    );
    return json<unknown>(body, '教室占用');
  });
}

// ─── 培养方案与学分完成 ─────────────────────────────────────────

const TRAIN_PROGRAM_HEADERS = {
  Accept: 'application/json, */*',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  Referer: `${ZHJW_BASE}/student/comprehensiveQuery/search/trainProgram/index`,
  'User-Agent': USER_AGENT,
};

async function trainProgramIndex(): Promise<string> {
  return getHtml('/student/comprehensiveQuery/search/trainProgram/index', '培养方案');
}

export async function fetchProgramColleges(): Promise<ScuOption[]> {
  return withZhjw(async () => selectOptions(await trainProgramIndex(), 'xsh'));
}

export async function fetchProgramGrades(): Promise<ScuOption[]> {
  return withZhjw(async () => selectOptions(await trainProgramIndex(), 'nj'));
}

export async function searchPrograms(input: {
  college?: string;
  grade?: string;
}): Promise<unknown[]> {
  return withZhjw(async () => {
    const body = await postForm(
      '/student/comprehensiveQuery/search/trainProgram/load',
      {
        famc: '',
        jhmc: '',
        nj: input.grade ?? '',
        xw: '',
        xzlx: '',
        xdlx: '00001',
        xsh: input.college ?? '',
        pageNum: '1',
        pageSize: '100',
      },
      '培养方案',
      TRAIN_PROGRAM_HEADERS,
    );
    const parsed = json<{ data?: { records?: unknown[] } }>(body, '培养方案');
    return parsed.data?.records ?? [];
  });
}

export async function fetchProgramDetail(fajhh: string): Promise<unknown> {
  return withZhjw(async () => {
    const body = await postForm(
      '/student/comprehensiveQuery/search/trainProgram/detail',
      { fajhh, lx: '1' },
      '培养方案详情',
      TRAIN_PROGRAM_HEADERS,
    );
    return json<unknown>(body, '培养方案详情');
  });
}

export async function fetchProgramCourseDetail(urlPath: string): Promise<unknown> {
  if (!urlPath.startsWith('/')) throw new Error('课程详情路径必须以 / 开头');
  return withZhjw(async () => {
    const body = await getHtml(urlPath, '课程详情', {
      Accept: 'application/json, */*',
      Referer: `${ZHJW_BASE}/student/comprehensiveQuery/search/trainProgram/index`,
      'User-Agent': USER_AGENT,
    });
    return json<unknown>(body, '课程详情');
  });
}

const Z_NODES_PATTERN = /var\s+zNodes\s*=\s*(\[[\s\S]*?\]);/;
const PLAN_NAME_PATTERN = /data:\s*\[\s*'([^']+)'\s*\]/;
const PLAN_LINK_PATTERN = /getPyfaIndex\/(\d+)/g;

export interface ScuPlanCompletion {
  readonly id: string;
  readonly name: string;
  readonly nodes: unknown[];
}

/** 计划完成度：单方案直接读 zNodes；多方案从选择页逐份取 getPyfaIndex 详情。 */
export async function fetchPlanCompletion(): Promise<ScuPlanCompletion[]> {
  return withZhjw(async () => {
    const index = await getHtml('/student/integratedQuery/planCompletion/index', '学分完成');
    if (index.includes('请勿频繁刷新')) throw new Error('教务系统限流：请勿频繁刷新');
    const direct = Z_NODES_PATTERN.exec(index);
    if (direct) {
      const nodes = JSON.parse(direct[1]!) as unknown[];
      if (nodes.length > 0)
        return [{ id: '', name: PLAN_NAME_PATTERN.exec(index)?.[1]?.trim() ?? '', nodes }];
    }
    const ids = [...new Set([...index.matchAll(PLAN_LINK_PATTERN)].map((match) => match[1]!))];
    const plans: ScuPlanCompletion[] = [];
    for (const id of ids) {
      if (plans.length > 0) await new Promise((resolve) => setTimeout(resolve, 600));
      const detail = await getHtml(
        `/student/integratedQuery/planCompletion/getPyfaIndex/${id}`,
        '学分完成',
      );
      if (detail.includes('请勿频繁刷新')) throw new Error('教务系统限流：请勿频繁刷新');
      const matched = Z_NODES_PATTERN.exec(detail);
      if (!matched) throw new Error('培养方案数据格式异常：详情页未找到 zNodes');
      plans.push({ id, name: `方案${id}`, nodes: JSON.parse(matched[1]!) as unknown[] });
    }
    return plans;
  });
}

// ─── 班级课表 ───────────────────────────────────────────────────

const CLASS_AJAX_HEADERS = {
  ...ZAJAX_HEADERS,
  Referer: `${ZHJW_BASE}/student/teachingResources/classCurriculum/index`,
};

export async function fetchClassScheduleOptions(): Promise<{
  semesters: ScuOption[];
  grades: ScuOption[];
  departments: ScuOption[];
}> {
  return withZhjw(async () => {
    const body = await getHtml('/student/teachingResources/classCurriculum/index', '班级课表');
    return {
      semesters: selectOptions(body, 'executiveEducationPlanNum'),
      grades: selectOptions(body, 'yearNum'),
      departments: selectOptions(body, 'departmentNum'),
    };
  });
}

export async function fetchClassSubjects(departmentNum: string): Promise<unknown[]> {
  return withZhjw(async () => {
    const response = await scuRequest(
      `${ZHJW_BASE}/student/teachingResources/gradeAndClassCurriculum/subjectJson?departmentNum=${encodeURIComponent(departmentNum)}`,
      { headers: CLASS_AJAX_HEADERS, timeoutMs: 30_000 },
    );
    assertAuthenticated(response, '专业列表');
    return json<unknown[]>(response.body, '专业列表');
  });
}

export async function searchClasses(input: {
  plan?: string;
  year?: string;
  department?: string;
  subject?: string;
  classNum?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ records: unknown[]; total: number }> {
  return withZhjw(async () => {
    const body = await postForm(
      '/student/teachingResources/classCurriculum/search',
      {
        executiveEducationPlanNum: input.plan ?? '',
        yearNum: input.year ?? '',
        departmentNum: input.department ?? '',
        subjectNum: input.subject ?? '',
        classNum: input.classNum ?? '',
        pageNum: String(input.page ?? 1),
        pageSize: String(input.pageSize ?? 100),
      },
      '班级列表',
      CLASS_AJAX_HEADERS,
    );
    const rows = json<Array<Record<string, unknown>>>(body, '班级列表');
    const first = rows[0];
    if (!first) return { records: [], total: 0 };
    const pageContext = first.pageContext as { totalCount?: unknown } | undefined;
    const total = typeof pageContext?.totalCount === 'number' ? pageContext.totalCount : 0;
    return { records: Array.isArray(first.records) ? first.records : [], total };
  });
}

export async function fetchClassSchedule(planCode: string, classCode: string): Promise<unknown[]> {
  return withZhjw(async () => {
    const response = await scuRequest(
      `${ZHJW_BASE}/student/teachingResources/classCurriculum/searchCurriculumInfo/callback?planCode=${encodeURIComponent(planCode)}&classCode=${encodeURIComponent(classCode)}`,
      { headers: CLASS_AJAX_HEADERS, timeoutMs: 30_000 },
    );
    assertAuthenticated(response, '班级课表');
    const rows = json<unknown[]>(response.body, '班级课表');
    const list = rows[0];
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new Error('班级课表返回格式异常');
    return list;
  });
}

// ─── 课程课表 ───────────────────────────────────────────────────

const COURSE_AJAX_HEADERS = {
  ...ZAJAX_HEADERS,
  Referer: `${ZHJW_BASE}/student/teachingResources/courseCurriculum/index`,
};

export async function fetchCourseCurriculumOptions(): Promise<{
  semesters: ScuOption[];
  departments: ScuOption[];
  categories: ScuOption[];
}> {
  return withZhjw(async () => {
    const body = await getHtml('/student/teachingResources/courseCurriculum/index', '课程课表');
    return {
      semesters: selectOptions(body, 'zxjxjhh'),
      departments: selectOptions(body, 'kkxsh'),
      categories: selectOptions(body, 'kclb'),
    };
  });
}

export async function searchCourses(input: {
  semester?: string;
  department?: string;
  name?: string;
  code?: string;
  seq?: string;
  category?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ records: unknown[]; total: number }> {
  return withZhjw(async () => {
    const body = await postForm(
      '/student/teachingResources/courseCurriculum/search',
      {
        zxjxjhh: input.semester ?? '',
        kkxsh: input.department ?? '',
        kcm: input.name ?? '',
        kch: input.code ?? '',
        kxh: input.seq ?? '',
        kclb: input.category ?? '',
        pageNum: String(input.page ?? 1),
        pageSize: String(input.pageSize ?? 100),
      },
      '课程查询',
      COURSE_AJAX_HEADERS,
    );
    const parsed = json<{ records?: unknown[]; pageContext?: { totalCount?: unknown } }>(
      body,
      '课程查询',
    );
    const total =
      typeof parsed.pageContext?.totalCount === 'number' ? parsed.pageContext.totalCount : 0;
    return { records: parsed.records ?? [], total };
  });
}

export async function fetchCourseSchedule(
  planCode: string,
  courseCode: string,
  courseSequenceCode: string,
): Promise<unknown[]> {
  return withZhjw(async () => {
    const response = await scuRequest(
      `${ZHJW_BASE}/student/teachingResources/courseCurriculum/searchCurriculum/callback?planCode=${encodeURIComponent(planCode)}&courseCode=${encodeURIComponent(courseCode)}&courseSequenceCode=${encodeURIComponent(courseSequenceCode)}`,
      { headers: COURSE_AJAX_HEADERS, timeoutMs: 30_000 },
    );
    assertAuthenticated(response, '课程课表');
    const rows = json<unknown[]>(response.body, '课程课表');
    const list = rows[0];
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new Error('课程课表返回格式异常');
    return list;
  });
}
