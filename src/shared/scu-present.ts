/** 校园服务展示层数据规范化：把教务/体测的原始 JSON 转成可直接渲染的行与卡片。
 *  渲染层与单元测试共用，纯函数、不做任何请求。 */

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface ScuGradeRow {
  readonly name: string;
  readonly english: string;
  readonly attribute: string;
  readonly credit: string;
  readonly score: string;
  readonly point: string;
  readonly grade: string;
  readonly term: string;
}

const NAME_KEYS = ['courseName', 'kcmc', 'KCMC', 'courseKName', 'name', 'courseTitle'];
const ENGLISH_KEYS = ['englishCourseName', 'courseNameEn', 'kcmcyw', 'KCMCYW'];
const ATTRIBUTE_KEYS = [
  'courseAttributeName',
  'courseAttribute',
  'courseCategory',
  'kclbmc',
  'KCLBMC',
];
const CREDIT_KEYS = ['credit', 'credits', 'xf', 'XF'];
const SCORE_KEYS = ['cj', 'CJ', 'courseScore', 'gradeScore', 'score', 'scoreValue', 'zcj', 'ZCJ'];
const POINT_KEYS = ['gradePointScore', 'gradePoint', 'jd', 'JD'];
const GRADE_KEYS = ['gradeName', 'grade', 'gradeLevel', 'dj', 'DJ'];
const TERM_KEYS = ['termName', 'xnxq', 'term', 'semesterName'];
const YEAR_KEYS = ['academicYearCode', 'academicYear', 'xn'];
const GROUP_KEYS = ['cjlx', 'groupName'];

function gradeRowOf(node: Node, term: string): ScuGradeRow | null {
  const name = text(...NAME_KEYS.map((key) => node[key]));
  const score = text(...SCORE_KEYS.map((key) => node[key]));
  if (!name && !score) return null;
  const nested = isNode(node.id) ? node.id : {};
  const ownTerm =
    [text(...YEAR_KEYS.map((key) => node[key])), text(...TERM_KEYS.map((key) => node[key]))]
      .filter(Boolean)
      .join(' ') || term;
  return {
    name: name || '未命名课程',
    english: text(...ENGLISH_KEYS.map((key) => node[key])),
    attribute: text(...ATTRIBUTE_KEYS.map((key) => node[key])),
    credit: text(...CREDIT_KEYS.map((key) => node[key])),
    score: score || text(...SCORE_KEYS.map((key) => nested[key])),
    point: text(...POINT_KEYS.map((key) => node[key])),
    grade: text(...GRADE_KEYS.map((key) => node[key])),
    term: ownTerm,
  };
}

function termOf(node: Node, inherited: string): string {
  const group = text(...GROUP_KEYS.map((key) => node[key]));
  if (group) return group;
  const own = [
    text(...YEAR_KEYS.map((key) => node[key])),
    text(...TERM_KEYS.map((key) => node[key])),
  ]
    .filter(Boolean)
    .join(' ');
  return own || inherited;
}

function walkGrades(value: unknown, term: string, out: ScuGradeRow[], depth: number): void {
  if (depth > 5 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) walkGrades(item, term, out, depth + 1);
    return;
  }
  if (!isNode(value)) return;
  const nextTerm = termOf(value, term);
  const row = gradeRowOf(value, nextTerm);
  if (row) {
    out.push(row);
    return;
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) walkGrades(child, nextTerm, out, depth + 1);
  }
}

/** 教务成绩（及格成绩 / 方案成绩）→ 课程行；结构不匹配时返回空数组。 */
export function scuGradeRows(value: unknown): ScuGradeRow[] {
  const rows: ScuGradeRow[] = [];
  walkGrades(value, '', rows, 0);
  return rows.sort((a, b) =>
    a.term === b.term ? a.name.localeCompare(b.name) : b.term.localeCompare(a.term),
  );
}

/** 成绩行摘要：门数、总学分、学分加权平均分与平均绩点（只统计有百分成绩的课）。 */
export interface ScuGradeSummary {
  readonly courses: number;
  readonly credits: number;
  readonly average: number | null;
  readonly gpa: number | null;
}

export function scuGradeSummary(rows: readonly ScuGradeRow[]): ScuGradeSummary {
  let credits = 0;
  let weighted = 0;
  let weightedPoint = 0;
  let counted = 0;
  let points = 0;
  for (const row of rows) {
    const credit = numeric(row.credit) ?? 0;
    const score = numeric(row.score);
    const point = numeric(row.point);
    if (credit > 0) credits += credit;
    if (score !== null && score >= 0 && credit > 0) {
      weighted += score * credit;
      counted += credit;
      if (point !== null && point >= 0) {
        weightedPoint += point * credit;
        points += credit;
      }
    }
  }
  return {
    courses: rows.length,
    credits,
    average: counted > 0 ? weighted / counted : null,
    gpa: points > 0 ? weightedPoint / points : null,
  };
}

const FITNESS_LABELS: Record<string, string> = {
  bmi: '体重指数',
  height: '身高',
  weight: '体重',
  vc: '肺活量',
  vital_capacity: '肺活量',
  fifty: '50 米跑',
  fifty_run: '50 米跑',
  run_50: '50 米跑',
  jump: '立定跳远',
  standing_jump: '立定跳远',
  sit_reach: '坐位体前屈',
  sitting_forward: '坐位体前屈',
  pull_up: '引体向上',
  pullup: '引体向上',
  sit_up: '仰卧起坐',
  situp: '仰卧起坐',
  endurance: '耐力跑',
  long_run: '耐力跑',
  run_800: '800 米跑',
  run_1000: '1000 米跑',
};

const FITNESS_INFO_LABELS: Record<string, string> = {
  student_num: '学号',
  student_name: '姓名',
  student_sex: '性别',
  student_college: '学院',
  student_class: '班级',
  academic_year: '学年',
  school_year: '学年',
};

export interface ScuFitnessItem {
  readonly label: string;
  readonly score: string;
  readonly grade: string;
}

export interface ScuFitnessSummary {
  readonly student: string;
  readonly total: string;
  readonly grade: string;
  readonly status: string;
  readonly description: string;
  readonly items: readonly ScuFitnessItem[];
}

/** 体测成绩 → 总分 + 分项；字段名带 _score/_grade 后缀，按后缀配对。 */
export function scuFitnessSummary(value: unknown): ScuFitnessSummary | null {
  if (!isNode(value)) return null;
  const student = [text(value.student_name), text(value.student_num)].filter(Boolean).join(' · ');
  const items: ScuFitnessItem[] = [];
  for (const key of Object.keys(value)) {
    if (!key.endsWith('_score')) continue;
    const base = key.slice(0, -'_score'.length);
    if (!base || base === 'total') continue;
    const grade = text(value[`${base}_grade`]);
    const score = text(value[key]);
    if (!score && !grade) continue;
    items.push({ label: FITNESS_LABELS[base] ?? base, score, grade });
  }
  const info = Object.entries(FITNESS_INFO_LABELS)
    .map(([key, label]) => [label, text(value[key])] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label} ${value}`)
    .join(' · ');
  return {
    student: student || info,
    total: text(value.total_score),
    grade: text(value.total_grade),
    status: text(value.report_status, value.report_type),
    description: text(value.report_desc),
    items,
  };
}

export interface ScuKeyValue {
  readonly label: string;
  readonly value: string;
}

const BALANCE_LABELS: Record<string, string> = {
  schoolName: '校区',
  regName: '楼栋',
  unitName: '单元',
  roomNo: '房间号',
  roomName: '房间号',
  custNo: '户号',
  custName: '户名',
  price: '单价（元/度）',
  balance: '剩余电量（度）',
};

/** 电费查询结果 → 键值列表；未知字段按原键名展示，空值跳过。 */
export function scuBalanceFields(value: unknown): ScuKeyValue[] {
  if (!isNode(value)) return [];
  const fields: ScuKeyValue[] = [];
  for (const [key, label] of Object.entries(BALANCE_LABELS)) {
    const raw = value[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const shown = typeof raw === 'number' ? String(raw) : text(raw);
    if (shown) fields.push({ label, value: shown });
  }
  return fields;
}

/** 读数取数值部分，供大字展示。 */
export function scuBalanceAmount(value: unknown): string | null {
  if (!isNode(value)) return null;
  const balance = numeric(value.balance);
  if (balance === null) return null;
  return balance.toFixed(2);
}

export function scuMoney(value: unknown): string | null {
  const price = numeric(value);
  return price === null ? null : price.toFixed(4);
}

// ─── 空闲教室 ───────────────────────────────────────────────────

export interface ScuClassroomCampus {
  readonly number: string;
  readonly name: string;
}

export interface ScuClassroomBuilding {
  readonly campusNumber: string;
  readonly number: string;
  readonly name: string;
}

export interface ScuClassroomType {
  readonly code: string;
  readonly name: string;
}

export type ScuClassroomStatus = 'free' | 'class' | 'exam' | 'experiment' | 'borrowed';

export interface ScuClassroomRow {
  readonly name: string;
  readonly seats: number | null;
  readonly type: string;
  readonly remark: string;
  /** 12 节课的占用状态（下标 0 = 第 1 节）。 */
  readonly statuses: readonly ScuClassroomStatus[];
}

export const CLASSROOM_PERIODS = 12;

const MODULE_STATUS: Readonly<Record<string, ScuClassroomStatus>> = {
  '06': 'class',
  '07': 'exam',
  '14': 'experiment',
  room: 'borrowed',
};

export function scuClassroomCampuses(value: unknown): ScuClassroomCampus[] {
  const campuses = isNode(value) ? value.campuses : value;
  if (!Array.isArray(campuses)) return [];
  return campuses.filter(isNode).map((raw) => ({
    number: text(raw.campusNumber),
    name: text(raw.campusName) || text(raw.campusNumber),
  }));
}

export function scuClassroomBuildings(value: unknown): ScuClassroomBuilding[] {
  const buildings = isNode(value) ? value.buildings : value;
  if (!Array.isArray(buildings)) return [];
  return buildings.filter(isNode).map((raw) => {
    const id = isNode(raw.id) ? raw.id : {};
    return {
      campusNumber: text(id.campusNumber),
      number: text(id.teachingBuildingNumber),
      name: text(raw.teachingBuildingName) || text(id.teachingBuildingNumber),
    };
  });
}

export function scuClassroomTypeList(value: unknown): ScuClassroomType[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isNode).map((raw) => ({
    code: text(raw.classroomtypecode),
    name: text(raw.classroomtypename) || text(raw.classroomtypecode),
  }));
}

/** 教室占用查询结果 → 每个教室 12 节的占用矩阵。 */
export function scuClassroomRows(value: unknown): ScuClassroomRow[] {
  if (!isNode(value)) return [];
  const classrooms = Array.isArray(value.classrooms) ? value.classrooms : [];
  const slots = Array.isArray(value.classroomTime) ? value.classroomTime : [];

  const byRoom = new Map<string, ScuClassroomStatus[]>();
  for (const raw of slots) {
    if (!isNode(raw)) continue;
    const id = isNode(raw.id) ? raw.id : {};
    const number = text(id.classroomNumber);
    if (!number) continue;
    const start = numeric(id.sessionstart) ?? 0;
    const duration = Math.max(1, numeric(raw.continuingsession) ?? 1);
    const status = MODULE_STATUS[text(raw.occupancymoduleId)] ?? 'free';
    const statuses =
      byRoom.get(number) ?? new Array<ScuClassroomStatus>(CLASSROOM_PERIODS).fill('free');
    for (let offset = 0; offset < duration; offset += 1) {
      const period = start + offset;
      if (period >= 1 && period <= CLASSROOM_PERIODS) statuses[period - 1] = status;
    }
    byRoom.set(number, statuses);
  }

  return classrooms.filter(isNode).map((raw) => {
    const id = isNode(raw.id) ? raw.id : {};
    const number = text(id.classroomNumber);
    return {
      name: text(raw.classroomName) || number,
      seats: numeric(raw.placeNum),
      type: text(raw.classroomTypeCode),
      remark: text(raw.remark),
      statuses:
        byRoom.get(number) ??
        new Array<ScuClassroomStatus>(CLASSROOM_PERIODS).fill('free' as ScuClassroomStatus),
    };
  });
}

export const CLASSROOM_STATUS_LABELS: Readonly<Record<ScuClassroomStatus, string>> = {
  free: '空闲',
  class: '上课',
  exam: '考试',
  experiment: '实验',
  borrowed: '借用',
};

// ─── 培养方案与学分完成 ─────────────────────────────────────────

function plainHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ScuProgramRow {
  readonly id: string;
  readonly name: string;
  readonly college: string;
  readonly grade: string;
  readonly degree: string;
  readonly level: string;
}

/** 培养方案搜索结果 → 展示行。 */
export function scuProgramRows(value: unknown): ScuProgramRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isNode).map((raw) => ({
    id: text(raw.FAJHH, raw.fajhh),
    name: text(raw.FAMC, raw.famc, raw.JHMC, raw.jhmc),
    college: text(raw.XSH, raw.xsh),
    grade: text(raw.NJ, raw.nj),
    degree: text(raw.XWDM, raw.xwdm),
    level: text(raw.XZLXDM, raw.xzlxdm, raw.XDLXDM, raw.xdlxdm),
  }));
}

export interface ScuProgramTreeNode {
  readonly id: string;
  readonly parentId: string;
  readonly depth: number;
  readonly name: string;
  readonly path: string;
  readonly hasChildren: boolean;
}

/** 培养方案树 → 按层级摊平（保留父节点顺序与缩进深度）。 */
export function scuProgramTree(value: unknown): ScuProgramTreeNode[] {
  const tree = isNode(value) ? value.treeList : value;
  if (!Array.isArray(tree)) return [];
  const nodes = tree.filter(isNode);
  const parents = new Map<string, string>();
  for (const node of nodes) parents.set(text(node.id), text(node.pId));
  const depthOf = (id: string): number => {
    let depth = 0;
    let current = parents.get(id) ?? '';
    const seen = new Set<string>();
    while (current && current !== '-1' && !seen.has(current) && depth < 20) {
      seen.add(current);
      depth += 1;
      current = parents.get(current) ?? '';
    }
    return depth;
  };
  return nodes.map((node) => {
    const id = text(node.id);
    return {
      id,
      parentId: text(node.pId),
      depth: depthOf(id),
      name: plainHtml(text(node.name, node.title)),
      path: text(node.urlPath),
      hasChildren: nodes.some((candidate) => text(candidate.pId) === id),
    };
  });
}

export interface ScuProgramCourseInfo {
  readonly title: string;
  readonly fields: readonly ScuKeyValue[];
}

const PROGRAM_COURSE_LABELS: readonly (readonly [string, string])[] = [
  ['kch', '课程号'],
  ['kcm', '课程名称'],
  ['ywkcm', '英文名称'],
  ['xf', '学分'],
  ['xs', '学时'],
  ['kclbmc', '课程类别'],
  ['kclbm', '课程类别码'],
  ['kczt', '课程状态'],
  ['kkxq', '开课学期'],
  ['kxh', '课序号'],
  ['jsm', '教师'],
];

/** 培养方案课程详情 → 标题 + 中文字段列表。 */
export function scuProgramCourse(value: unknown): ScuProgramCourseInfo | null {
  if (!isNode(value)) return null;
  const kc = isNode(value.kc) ? value.kc : value;
  const title = text(kc.kcm, kc.kch) || '课程详情';
  const fields: ScuKeyValue[] = [];
  for (const [key, label] of PROGRAM_COURSE_LABELS) {
    const shown = text(kc[key]);
    if (shown) fields.push({ label, value: shown });
  }
  return fields.length > 0 ? { title, fields } : null;
}

// ─── 班级课表 / 课程课表 ─────────────────────────────────────────

export interface ScuClassRow {
  readonly planCode: string;
  readonly classCode: string;
  readonly name: string;
  readonly planName: string;
  readonly department: string;
  readonly subject: string;
}

export function scuClassRows(value: unknown): ScuClassRow[] {
  const records = isNode(value) ? value.records : value;
  if (!Array.isArray(records)) return [];
  return records.filter(isNode).map((raw) => {
    const id = isNode(raw.id) ? raw.id : {};
    return {
      planCode: text(id.executiveEducationPlanNumber),
      classCode: text(id.classNum),
      name: text(raw.className) || text(id.classNum),
      planName: text(raw.executiveEducationPlanName),
      department: text(raw.departmentName),
      subject: text(raw.subjectName),
    };
  });
}

export interface ScuCourseRow {
  readonly planCode: string;
  readonly planName: string;
  readonly courseCode: string;
  readonly courseSeq: string;
  readonly name: string;
  readonly credits: string;
  readonly category: string;
  readonly examType: string;
  readonly department: string;
  readonly teachers: string;
}

export function scuCourseRows(value: unknown): ScuCourseRow[] {
  const records = isNode(value) ? value.records : value;
  if (!Array.isArray(records)) return [];
  return records.filter(isNode).map((raw) => ({
    planCode: text(raw.ZXJXJHH),
    planName: text(raw.ZXJXJHM),
    courseCode: text(raw.KCH),
    courseSeq: text(raw.KXH),
    name: text(raw.KCM),
    credits: text(raw.XF),
    category: text(raw.KCLBMC),
    examType: text(raw.KSLXMC),
    department: text(raw.KKXSM),
    teachers: text(raw.JSM),
  }));
}

export interface ScuScheduleItem {
  readonly weekday: number;
  readonly startPeriod: number;
  readonly duration: number;
  readonly name: string;
  readonly teacher: string;
  readonly weeks: string;
  readonly campus: string;
  readonly building: string;
  readonly room: string;
  readonly courseCode: string;
}

export function scuScheduleItems(value: unknown): ScuScheduleItem[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .filter(isNode)
    .map((raw) => {
      const id = isNode(raw.id) ? raw.id : {};
      return {
        weekday: numeric(id.skxq) ?? 0,
        startPeriod: numeric(id.skjc) ?? 0,
        duration: Math.max(1, numeric(raw.cxjc) ?? 1),
        name: text(raw.kcm),
        teacher: text(raw.jsm),
        weeks: text(raw.zcsm),
        campus: text(raw.xqm),
        building: text(raw.jxlm),
        room: text(raw.jasm),
        courseCode: text(id.kch),
      };
    })
    .sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod);
}

/** 专业筛选选项：[{subjectCode, subjectName}]。 */
export function scuSubjects(value: unknown): { value: string; label: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isNode)
    .map((raw) => ({
      value: text(raw.subjectCode),
      label: text(raw.subjectName) || text(raw.subjectCode),
    }))
    .filter((item) => item.value);
}

export interface ScuCompletionCourse {
  readonly depth: number;
  readonly name: string;
  readonly completed: boolean;
  readonly earned: number | null;
  readonly required: number | null;
  readonly courseCode: string;
  readonly credits: string;
  readonly term: string;
  readonly grade: string;
  readonly isCourse: boolean;
}

export interface ScuCompletionPlan {
  readonly id: string;
  readonly name: string;
  readonly earned: number;
  readonly required: number;
  readonly rows: readonly ScuCompletionCourse[];
}

function parseCourseName(raw: string): {
  name: string;
  courseCode: string;
  credits: string;
  term: string;
  grade: string;
} {
  const plain = plainHtml(raw);
  // 形如 [课程号]课程名[1学分，2023-2024学年秋](必修,96.0(20240107))
  const codeMatch = /^\[([^\]]+)\]\s*/.exec(plain);
  const courseCode = codeMatch?.[1] ?? '';
  let rest = codeMatch ? plain.slice(codeMatch[0].length) : plain;

  let grade = '';
  const paren = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(rest);
  if (paren) {
    const parts = (paren[1] ?? '').split(/[,，]/);
    grade = (parts[1] ?? '')
      .trim()
      .replace(/\([^)]*\)/g, '')
      .trim();
    rest = rest.slice(0, paren.index).trim();
  }

  let meta = '';
  const metaMatch = /\[([^\]]*)\]\s*$/.exec(rest);
  if (metaMatch) {
    meta = metaMatch[1] ?? '';
    rest = rest.slice(0, metaMatch.index).trim();
  }

  const creditMatch = /([\d.]+)\s*学分/.exec(meta);
  const termMatch = /(\d{4}-\d{4}[^\s,，]*|\d{4}-\d{2})/.exec(meta);
  return {
    name: rest || plain,
    courseCode,
    credits: creditMatch?.[1] ?? '',
    term: termMatch?.[1] ?? '',
    grade,
  };
}

/** 学分完成 zNodes → 每个方案的整体进度与节点行（按 parentId 计算缩进）。 */
export function scuCompletionPlans(value: unknown): ScuCompletionPlan[] {
  const plans = Array.isArray(value) ? value : [];
  return plans.filter(isNode).map((plan) => {
    const nodes = Array.isArray(plan.nodes) ? plan.nodes.filter(isNode) : [];
    const parents = new Map<string, string>();
    for (const node of nodes) parents.set(text(node.id), text(node.pId));
    const depthOf = (id: string): number => {
      let depth = 0;
      let current = parents.get(id) ?? '';
      const seen = new Set<string>();
      while (current && current !== '-1' && !seen.has(current) && depth < 20) {
        seen.add(current);
        depth += 1;
        current = parents.get(current) ?? '';
      }
      return depth;
    };
    const rows: ScuCompletionCourse[] = nodes.map((node) => {
      const id = text(node.id);
      const isCourse = text(node.flagType) === 'kch';
      const parsed = isCourse
        ? parseCourseName(text(node.name))
        : { name: plainHtml(text(node.name)), courseCode: '', credits: '', term: '', grade: '' };
      return {
        depth: depthOf(id),
        name: parsed.name,
        completed: text(node.sfwc) === '是',
        earned: numeric(node.yxxf),
        required: numeric(node.zsxf),
        courseCode: parsed.courseCode,
        credits: parsed.credits,
        term: parsed.term,
        grade: parsed.grade,
        isCourse,
      };
    });
    const roots = nodes.filter((node) => {
      const parent = text(node.pId);
      return !parent || parent === '-1';
    });
    const earned = roots.reduce((sum, node) => sum + (numeric(node.yxxf) ?? 0), 0);
    const required = roots.reduce((sum, node) => sum + (numeric(node.zsxf) ?? 0), 0);
    return {
      id: text(plan.id),
      name: text(plan.name),
      earned,
      required,
      rows,
    };
  });
}
