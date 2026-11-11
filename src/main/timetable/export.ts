/** 校历导入本地日历 / 导出 ICS（课表 + 考表 + 日历事件）。 */
import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lessonOccurrences } from '../../shared/schedule';
import { getDatabase } from '../database';
import { fetchAcademicCalendar } from '../scu/academic-calendar';
import { fetchExams } from '../scu/zhjw';
import { getTimetableState, listCalendarEvents, listLessons } from './api';
import { buildIcs, type IcsEvent } from './ics';

function shanghaiMidnight(date: string, plusDays = 0): string {
  const base = new Date(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(base.getTime())) throw new Error(`校历日期无效：${date}`);
  return new Date(base.getTime() + plusDays * 86400000).toISOString();
}

/** 把校历事件写入本地日历（按 标题 + 开始时间 去重）。 */
export async function importAcademicCalendar(
  semesterName?: string,
): Promise<{ imported: number; semester: string }> {
  const calendar = await fetchAcademicCalendar();
  const semester = semesterName
    ? calendar.semesters.find((item) => item.name === semesterName)
    : calendar.semesters[0];
  if (!semester) throw new Error(`校历中没有学期：${semesterName ?? ''}`);

  const db = getDatabase();
  const exists = db.prepare('SELECT 1 FROM calendar_events WHERE title = ? AND start_at = ?');
  const insert = db.prepare(
    `INSERT INTO calendar_events (title, start_at, end_at, location, color, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  let imported = 0;
  db.transaction(() => {
    for (const event of semester.events) {
      const title = `${semester.name} · ${event.label}`;
      const startAt = shanghaiMidnight(event.date);
      const endAt = shanghaiMidnight(event.endDate ?? event.date, 1);
      if (exists.get(title, startAt)) continue;
      insert.run(title, startAt, endAt, null, null, now);
      imported += 1;
    }
  })();
  return { imported, semester: semester.name };
}

function examEvents(
  exams: readonly {
    courseName: string;
    date: string;
    timeRange: string;
    location: string;
    seatNumber: string;
  }[],
): { events: IcsEvent[]; skipped: number } {
  const events: IcsEvent[] = [];
  let skipped = 0;
  for (const exam of exams) {
    const range = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(exam.timeRange);
    if (!range || !/^\d{4}-\d{2}-\d{2}$/.test(exam.date)) {
      skipped += 1;
      continue;
    }
    const [, sh, sm, eh, em] = range;
    const start = new Date(`${exam.date}T${sh!.padStart(2, '0')}:${sm}:00+08:00`);
    const end = new Date(`${exam.date}T${eh!.padStart(2, '0')}:${em}:00+08:00`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      skipped += 1;
      continue;
    }
    events.push({
      title: `考试 · ${exam.courseName}`,
      seed: `exam|${exam.courseName}|${exam.date}|${exam.timeRange}`,
      start: start.toISOString(),
      end: end.toISOString(),
      location: exam.location || null,
      description: exam.seatNumber ? `座位号：${exam.seatNumber}` : null,
    });
  }
  return { events, skipped };
}

/** 导出当前学期（或指定学期）的课表、考表与本地日历事件为 .ics，写入下载目录。 */
export async function exportTimetableIcs(
  semester?: string,
): Promise<{ path: string; events: number; skipped: number }> {
  const state = getTimetableState(semester);
  if (!state.semesterStart) {
    throw new Error('缺少开学日期，无法把课表展开成实际日期（请先同步或手动设置开学日期）');
  }
  const startDate = new Date(`${state.semesterStart}T00:00:00+08:00`);
  if (!Number.isFinite(startDate.getTime())) throw new Error('学期开始日期无效');
  const endDate = new Date(startDate.getTime() + 21 * 7 * 86400000);

  const occurrences = lessonOccurrences(
    listLessons(state.semester),
    state.semesterStart,
    startDate.toISOString(),
    endDate.toISOString(),
  );
  const events: IcsEvent[] = occurrences.items.map((item) => ({
    title: item.title,
    seed: `lesson|${state.semester}|${item.lessonId}|${item.startAt}`,
    start: item.startAt,
    end: item.endAt,
    location: item.location,
  }));
  let skipped = occurrences.warnings.length;

  try {
    const exams = await fetchExams();
    const exported = examEvents(exams);
    events.push(...exported.events);
    skipped += exported.skipped;
  } catch {
    // 未登录或教务异常时只导出课表；不因此让整次导出失败。
    skipped += 1;
  }

  for (const event of listCalendarEvents(startDate.toISOString(), endDate.toISOString())) {
    events.push({
      title: event.title,
      seed: `event|${event.id}|${event.startAt}`,
      start: event.startAt,
      end: event.endAt,
      location: event.location,
    });
  }

  const ics = buildIcs(events, `明远湖课表 ${state.semester}`);
  const path = join(app.getPath('downloads'), `明远湖课表-${state.semester}.ics`);
  writeFileSync(path, ics, 'utf8');
  return { path, events: events.length, skipped };
}
