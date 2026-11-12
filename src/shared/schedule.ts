import type { TimetableLesson } from './api';

/** 川大节次时段（4-5-3 结构，共 12 节；移植自 SCU-CLI `internal/ics/campus.go`）。
 *  江安与望江/华西的作息不同，按课程地点里的校区名选择。 */
const jiangAnPeriods = [
  [8 * 60 + 15, 9 * 60],
  [9 * 60 + 10, 9 * 60 + 55],
  [10 * 60 + 15, 11 * 60],
  [11 * 60 + 10, 11 * 60 + 55],
  [13 * 60 + 50, 14 * 60 + 35],
  [14 * 60 + 45, 15 * 60 + 30],
  [15 * 60 + 40, 16 * 60 + 25],
  [16 * 60 + 45, 17 * 60 + 30],
  [17 * 60 + 40, 18 * 60 + 25],
  [19 * 60 + 20, 20 * 60 + 5],
  [20 * 60 + 15, 21 * 60],
  [21 * 60 + 10, 21 * 60 + 55],
] as const;

const wangJiangHuaXiPeriods = [
  [8 * 60, 8 * 60 + 45],
  [8 * 60 + 55, 9 * 60 + 40],
  [10 * 60, 10 * 60 + 45],
  [10 * 60 + 55, 11 * 60 + 40],
  [14 * 60, 14 * 60 + 45],
  [14 * 60 + 55, 15 * 60 + 40],
  [15 * 60 + 50, 16 * 60 + 35],
  [16 * 60 + 55, 17 * 60 + 40],
  [17 * 60 + 50, 18 * 60 + 35],
  [19 * 60 + 30, 20 * 60 + 15],
  [20 * 60 + 25, 21 * 60 + 10],
  [21 * 60 + 20, 22 * 60 + 5],
] as const;

export type ClassPeriod = readonly [number, number];

/** 当前学期的 SCU planCode（第三段 1=秋季、2=春季）。主进程与渲染层共用同一算法。 */
export function currentSemesterCode(now = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 8) return `${year}-${year + 1}-1-1`;
  if (month <= 1) return `${year - 1}-${year}-1-1`;
  return `${year - 1}-${year}-2-1`;
}

/** 按校区返回节次时段；无法识别时用江安（最常见）作息。 */
export function classPeriodsFor(campus: string | null | undefined): readonly ClassPeriod[] {
  if (campus && /望江|华西/.test(campus)) return wangJiangHuaXiPeriods;
  return jiangAnPeriods;
}

/** 默认节次表（江安）。渲染层画周视图时间轴时用。 */
export const classPeriods: readonly ClassPeriod[] = jiangAnPeriods;

export function lessonOccurrences(
  lessons: readonly TimetableLesson[],
  semesterStart: string | null,
  startAt: string,
  endAt: string,
) {
  const warnings: string[] = [];
  const items: {
    source: 'course';
    lessonId: number;
    title: string;
    startAt: string;
    endAt: string;
    location: string | null;
  }[] = [];
  if (!semesterStart) return { items, warnings: ['缺少学期开始日期，无法将课程转换为实际日期'] };
  const date = new Date(`${semesterStart}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== semesterStart)
    return { items, warnings: ['学期开始日期无效'] };
  const day = 86400000;
  const monday = date.getTime() - ((date.getUTCDay() + 6) % 7) * day - 8 * 3600000;
  const rangeStart = Date.parse(startAt),
    rangeEnd = Date.parse(endAt);
  for (const lesson of lessons) {
    const periods = classPeriodsFor(lesson.campus ?? lesson.classroom);
    const start = periods[lesson.startPeriod - 1]?.[0];
    const end = periods[lesson.endPeriod - 1]?.[1];
    if (
      !lesson.weekNumbers.length ||
      start === undefined ||
      end === undefined ||
      end <= start ||
      lesson.weekday < 1 ||
      lesson.weekday > 7
    ) {
      warnings.push(`${lesson.courseName}：缺少有效周次或节次，未计入时间安排`);
      continue;
    }
    for (const week of lesson.weekNumbers) {
      const base = monday + ((week - 1) * 7 + lesson.weekday - 1) * day;
      const begin = base + start * 60000,
        finish = base + end * 60000;
      if (finish > rangeStart && begin < rangeEnd)
        items.push({
          source: 'course',
          lessonId: lesson.id,
          title: lesson.courseName,
          startAt: new Date(begin).toISOString(),
          endAt: new Date(finish).toISOString(),
          location: lesson.classroom,
        });
    }
  }
  return { items, warnings };
}
