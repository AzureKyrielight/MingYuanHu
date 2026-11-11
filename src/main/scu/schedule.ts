/** 川大课表纯解析：不依赖 Electron，便于单元测试与复用。 */
export interface ScuScheduleLesson {
  readonly sourceId: string;
  readonly courseCode: string;
  readonly courseName: string;
  readonly className: string | null;
  readonly teacher: string | null;
  readonly campus: string | null;
  readonly classroom: string | null;
  readonly weekday: number;
  readonly startPeriod: number;
  readonly endPeriod: number;
  readonly periodsText: string;
  readonly weeksText: string;
  readonly weekNumbers: string;
  readonly credits: number | null;
  readonly note: string | null;
}

export interface ParsedSchedule {
  readonly lessons: ScuScheduleLesson[];
  readonly courseCount: number;
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberField(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** 当前学期的 SCU planCode（第三段 1=秋季、2=春季）。 */
export function currentPlanCode(now = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 8) return `${year}-${year + 1}-1-1`;
  if (month <= 1) return `${year - 1}-${year}-1-1`;
  return `${year - 1}-${year}-2-1`;
}

export function isPlanCode(value: string): boolean {
  return /^\d{4}-\d{4}-[12]-\d+$/.test(value);
}

function activeWeeks(classWeek: string): number[] {
  if (/^[01]+$/.test(classWeek)) {
    const weeks: number[] = [];
    for (let index = 0; index < classWeek.length; index += 1)
      if (classWeek[index] === '1') weeks.push(index + 1);
    return weeks;
  }
  const weeks = new Set<number>();
  const odd = /单/.test(classWeek);
  const even = /双/.test(classWeek);
  for (const part of classWeek.replace(/[周()（）单双]/g, '').split(/[,，、]/)) {
    const numbers = part.match(/\d+/g)?.map(Number) ?? [];
    if (numbers.length === 0) continue;
    const start = numbers[0]!;
    const end = numbers[1] ?? start;
    for (let week = start; week <= end && week <= 30; week += 1) {
      if ((odd && week % 2 === 0) || (even && week % 2 === 1)) continue;
      weeks.add(week);
    }
  }
  return [...weeks].sort((a, b) => a - b);
}

function formatWeeks(weeks: readonly number[]): string {
  if (weeks.length === 0) return '周次未提供';
  if (weeks.length > 1) {
    const odd = weeks.every((week) => week % 2 === 1) && weeks[1]! - weeks[0]! === 2;
    const even = weeks.every((week) => week % 2 === 0) && weeks[1]! - weeks[0]! === 2;
    if (odd || even) return `${weeks[0]}-${weeks.at(-1)}周（${odd ? '单' : '双'}周）`;
  }
  const ranges: string[] = [];
  let start = weeks[0]!;
  let end = weeks[0]!;
  for (const week of weeks.slice(1)) {
    if (week === end + 1) {
      end = week;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = week;
    end = week;
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return `${ranges.join(',')}周`;
}

function campusOf(location: string): string | null {
  for (const campus of ['江安', '望江', '华西']) if (location.includes(campus)) return campus;
  return null;
}

/** 解析教务课表原始 JSON（SCU-CLI ParseScheduleCourses 的 TS 版本）。 */
export function parseScheduleCourses(raw: unknown): ParsedSchedule {
  const root = raw as { xkxx?: unknown } | null;
  const xkxx = Array.isArray(root?.xkxx) ? root.xkxx : [];
  const lessons: ScuScheduleLesson[] = [];
  let courseCount = 0;
  let sequence = 0;
  for (const item of xkxx) {
    if (typeof item !== 'object' || item === null) continue;
    for (const value of Object.values(item as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const details = value as {
        courseName?: unknown;
        attendClassTeacher?: unknown;
        id?: { coureSequenceNumber?: unknown };
        timeAndPlaceList?: unknown;
      };
      const courseName = textField(details.courseName);
      if (!courseName) continue;
      courseCount += 1;
      const teacher = textField(details.attendClassTeacher) || null;
      const sequenceNumber = textField(details.id?.coureSequenceNumber);
      const list = Array.isArray(details.timeAndPlaceList) ? details.timeAndPlaceList : [];
      for (const slot of list) {
        if (typeof slot !== 'object' || slot === null) continue;
        const entry = slot as Record<string, unknown>;
        const weekday = numberField(entry.classDay);
        const startPeriod = numberField(entry.classSessions);
        const continuing = numberField(entry.continuingSession);
        if (weekday < 1 || weekday > 7 || startPeriod < 1 || continuing < 1) continue;
        const classWeek = textField(entry.classWeek);
        const weeks = activeWeeks(classWeek);
        if (weeks.length === 0) continue;
        const building = textField(entry.teachingBuildingName);
        const classroom = textField(entry.classroomName);
        const location = `${building}${classroom}`;
        const endPeriod = startPeriod + continuing - 1;
        sequence += 1;
        lessons.push({
          sourceId: `${courseName}-${weekday}-${startPeriod}-${sequence}`,
          courseCode: '',
          courseName,
          className: sequenceNumber || null,
          teacher,
          campus: campusOf(location),
          classroom: location || null,
          weekday,
          startPeriod,
          endPeriod,
          periodsText: `${startPeriod}-${endPeriod}节`,
          weeksText: formatWeeks(weeks),
          weekNumbers: JSON.stringify(weeks),
          credits: null,
          note: sequenceNumber ? `课序号 ${sequenceNumber}` : null,
        });
      }
    }
  }
  return { lessons, courseCount };
}
