import type { WebContents } from 'electron';
import { z } from 'zod';
import {
  calendarEventColors,
  type CalendarEvent,
  type TimetableLesson,
  type TimetableResult,
  type TimetableState,
} from '../../shared/api';
import { getDatabase } from '../database';
import { lessonOccurrences } from '../../shared/schedule';
import { CampusAuthError, flushCampusSession, openCampusLoginWindow } from '../campus';
import {
  currentPlanCode,
  fetchCurrentWeek,
  fetchSchedule,
  fetchSemesters,
  isPlanCode,
  parseScheduleCourses,
} from '../scu/zhjw';

/** 统一认证 → 教务 SSO，顺带建立 id.scu.edu.cn 会话（微服务类功能复用）。 */
const ID_SSO_ZHJW =
  'https://id.scu.edu.cn/enduser/sp/sso/scdxplugin_jwt23?enterpriseId=scdx&target_url=index';

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 由教务「当前教学周」反推学期开始日期（该周周一）。
 * 只对当前学期有意义：历史学期拿不到周次对应关系，返回 null 交给用户手填。
 */
export async function deriveSemesterStart(
  semester: string,
  now = new Date(),
): Promise<string | null> {
  if (semester !== currentSemester(now)) return null;
  const { week, onVacation } = await fetchCurrentWeek();
  if (onVacation) return null;
  return semesterStartFromWeek(week, now);
}

/** 第 week 周所在周一（本地日历日）；周次非法时返回 null。 */
export function semesterStartFromWeek(week: number, now = new Date()): string | null {
  if (!Number.isInteger(week) || week < 1) return null;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - (week - 1) * 7);
  return localDateString(monday);
}

const semesterSchema = z
  .string()
  .refine(isPlanCode, '学期格式应为川大 planCode（如 2025-2026-2-1）');
const dateTimeSchema = z.string().datetime();
const calendarEventSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    startAt: dateTimeSchema,
    endAt: dateTimeSchema,
    location: z.string().trim().max(120).optional(),
    color: z.enum(calendarEventColors).optional(),
  })
  .refine(
    (event) => new Date(event.endAt).getTime() > new Date(event.startAt).getTime(),
    '结束时间必须晚于开始时间',
  );

type LessonRow = {
  id: number;
  semester: string;
  course_code: string;
  course_name: string;
  class_name: string | null;
  teacher: string | null;
  campus: string | null;
  classroom: string | null;
  weekday: number;
  start_period: number;
  end_period: number;
  periods_text: string;
  weeks_text: string;
  week_numbers: string;
  credits: number | null;
  note: string | null;
};

type CalendarEventRow = {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  color: string | null;
};

function mapEvent(row: CalendarEventRow): CalendarEvent {
  const stored = row.color;
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    location: row.location,
    // 旧缓存或异常值回退为无色，渲染时按中性色处理。
    color:
      stored && (calendarEventColors as readonly string[]).includes(stored)
        ? (stored as CalendarEvent['color'])
        : null,
  };
}

export function currentSemester(now = new Date()): string {
  return currentPlanCode(now);
}

export function resolveSemester(requested: unknown): string {
  return requested === undefined ? currentSemester() : semesterSchema.parse(requested);
}

function syncRow(
  semester: string,
): { last_synced_at: string; semester_start: string | null } | undefined {
  return getDatabase()
    .prepare('SELECT last_synced_at, semester_start FROM timetable_sync WHERE semester = ?')
    .get(semester) as { last_synced_at: string; semester_start: string | null } | undefined;
}

export function parseWeekNumbers(value: string | undefined): number[] {
  if (!value) return [];
  const odd = /单/.test(value);
  const even = /双/.test(value);
  const result = new Set<number>();
  for (const part of value.replace(/[周()（）单双]/g, '').split(/[,，、]/)) {
    const numbers = part.match(/\d+/g)?.map(Number) ?? [];
    if (numbers.length === 0) continue;
    const start = numbers[0]!;
    const end = numbers[1] ?? start;
    for (let week = start; week <= end && week <= 30; week += 1) {
      if ((odd && week % 2 === 0) || (even && week % 2 === 1)) continue;
      result.add(week);
    }
  }
  return [...result].sort((a, b) => a - b);
}

function mapRow(row: LessonRow): TimetableLesson {
  let weekNumbers: number[] = [];
  try {
    const parsed: unknown = JSON.parse(row.week_numbers);
    if (Array.isArray(parsed))
      weekNumbers = parsed.filter((week): week is number => Number.isInteger(week));
  } catch {
    // Keep the cached lesson visible even if a future schema changes the stored value.
  }
  return {
    id: row.id,
    semester: row.semester,
    courseCode: row.course_code,
    courseName: row.course_name,
    className: row.class_name,
    teacher: row.teacher,
    campus: row.campus,
    classroom: row.classroom,
    weekday: row.weekday,
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    periodsText: row.periods_text,
    weeksText: row.weeks_text,
    weekNumbers,
    credits: row.credits,
    note: row.note,
  };
}

export function openLoginWindow(sender: WebContents): Promise<TimetableResult> {
  return openCampusLoginWindow({
    sender,
    title: '连接四川大学统一身份认证',
    url: ID_SSO_ZHJW,
    reached: (url) => {
      try {
        const target = new URL(url);
        return target.hostname === 'zhjw.scu.edu.cn' && !target.pathname.includes('login');
      } catch {
        return false;
      }
    },
    probe: async () => {
      await fetchSemesters();
      await flushCampusSession();
    },
  });
}

async function fetchTimetable(semester: string) {
  return parseScheduleCourses(await fetchSchedule(semester));
}

export async function syncTimetable(semester: string): Promise<TimetableResult> {
  try {
    const parsed = await fetchTimetable(semester);
    await flushCampusSession();

    const lessons = parsed.lessons.map((lesson) => ({ semester, ...lesson }));

    const db = getDatabase();
    const insert = db.prepare(
      `INSERT INTO timetable_lessons
       (semester, source_id, course_code, course_name, class_name, teacher, campus, classroom,
        weekday, start_period, end_period, periods_text, weeks_text, week_numbers, credits, note)
       VALUES (@semester, @sourceId, @courseCode, @courseName, @className, @teacher, @campus,
        @classroom, @weekday, @startPeriod, @endPeriod, @periodsText, @weeksText, @weekNumbers,
        @credits, @note)`,
    );
    const syncedAt = new Date().toISOString();
    // 同步时顺便反推开学日期：教务首页能读到当前教学周，据此换算该周周一。
    // 失败（假期/非当前学期/未登录）不影响课表本身落库。
    const semesterStart = await deriveSemesterStart(semester).catch(() => null);
    db.transaction(() => {
      db.prepare('DELETE FROM timetable_lessons WHERE semester = ?').run(semester);
      for (const lesson of lessons) insert.run(lesson);
      db.prepare(
        `INSERT INTO timetable_sync (semester, last_synced_at, semester_start) VALUES (?, ?, ?)
         ON CONFLICT(semester) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           semester_start = COALESCE(timetable_sync.semester_start, excluded.semester_start)`,
      ).run(semester, syncedAt, semesterStart);
    })();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof CampusAuthError ? { reason: 'auth' as const } : {}),
    };
  }
}

export function listLessons(semester: string): TimetableLesson[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM timetable_lessons WHERE semester = ?
       ORDER BY weekday, start_period, course_name`,
    )
    .all(semester) as LessonRow[];
  return rows.map(mapRow);
}

export const scheduleQuerySchema = z
  .object({
    semester: semesterSchema.optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.endAt) > Date.parse(value.startAt) &&
      Date.parse(value.endAt) - Date.parse(value.startAt) <= 366 * 86400000,
    '查询范围必须为正数且不超过一年',
  );

export function querySchedule(input: unknown) {
  const args = scheduleQuerySchema.parse(input);
  const semester = args.semester ?? currentSemester();
  const row = syncRow(semester);
  const courses = lessonOccurrences(
    listLessons(semester),
    row?.semester_start ?? null,
    args.startAt,
    args.endAt,
  );
  const events = listCalendarEvents(args.startAt, args.endAt).map((event) => ({
    ...event,
    source: 'event' as const,
  }));
  const warnings = [...courses.warnings];
  if (!row?.last_synced_at) warnings.push('该学期课表尚未同步');
  return {
    semester,
    timezone: 'Asia/Shanghai',
    items: [...courses.items, ...events].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    coverage: {
      courseSyncedAt: row?.last_synced_at || null,
      complete: warnings.length === 0,
      warnings,
    },
  };
}

export function listCalendarEvents(startValue: unknown, endValue: unknown) {
  const startAt = dateTimeSchema.parse(startValue);
  const endAt = dateTimeSchema.parse(endValue);
  return (
    getDatabase()
      .prepare(
        `SELECT id, title, start_at, end_at, location, color FROM calendar_events
         WHERE end_at > ? AND start_at < ? ORDER BY start_at`,
      )
      .all(startAt, endAt) as CalendarEventRow[]
  ).map(mapEvent);
}

export function createCalendarEvent(input: unknown) {
  const event = calendarEventSchema.parse(input);
  const result = getDatabase()
    .prepare(
      `INSERT INTO calendar_events (title, start_at, end_at, location, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.title,
      event.startAt,
      event.endAt,
      event.location || null,
      event.color || null,
      new Date().toISOString(),
    );
  return mapEvent({
    id: Number(result.lastInsertRowid),
    title: event.title,
    start_at: event.startAt,
    end_at: event.endAt,
    location: event.location || null,
    color: event.color || null,
  });
}

export function deleteCalendarEvent(id: unknown) {
  // 只删自建事件；课程在 timetable_lessons 表，不经此入口。
  const eventId = z.number().int().positive().parse(id);
  getDatabase().prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId);
}

/** calendar_events 表只读视图；不存在返回 null。 */
export function getCalendarEvent(idInput: unknown): CalendarEvent | null {
  const id = z.number().int().positive().parse(idInput);
  const row = getDatabase()
    .prepare(
      'SELECT id, title, start_at, end_at, location, color FROM calendar_events WHERE id = ?',
    )
    .get(id) as CalendarEventRow | undefined;
  return row ? mapEvent(row) : null;
}

export function getTimetableState(requested?: unknown): TimetableState {
  const semester = resolveSemester(requested);
  const row = syncRow(semester);
  return {
    semester,
    lastSyncedAt: row?.last_synced_at || null,
    semesterStart: row?.semester_start ?? null,
  };
}

/**
 * 补齐缺失的开学日期：已经设置过就原样返回；
 * 没设置时用教务当前教学周反推一次并落库（失败则保持为空）。
 */
export async function refreshSemesterStart(requested?: unknown): Promise<TimetableState> {
  const semester = resolveSemester(requested);
  if (syncRow(semester)?.semester_start) return getTimetableState(semester);
  const value = await deriveSemesterStart(semester).catch(() => null);
  if (value) {
    getDatabase()
      .prepare(
        `INSERT INTO timetable_sync (semester, last_synced_at, semester_start) VALUES (?, '', ?)
         ON CONFLICT(semester) DO UPDATE SET semester_start = excluded.semester_start`,
      )
      .run(semester, value);
  }
  return getTimetableState(semester);
}

export function setSemesterStart(requested: unknown, value: unknown) {
  const semester = semesterSchema.parse(requested);
  // 手动补设学期日期时可能还没有同步记录，先落到空串以满足 NOT NULL。
  getDatabase()
    .prepare(
      `INSERT INTO timetable_sync (semester, last_synced_at, semester_start) VALUES (?, '', ?)
       ON CONFLICT(semester) DO UPDATE SET semester_start = excluded.semester_start`,
    )
    .run(
      semester,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(value),
    );
}
