/** 川大校历：公开 JSON（Bugaoshan 仓库镜像），免认证；网络失败时回退本地缓存。 */
import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AcademicCalendar,
  AcademicCalendarEvent,
  AcademicCalendarSemester,
} from '../../shared/timetable';

const MIRROR =
  'https://gh-proxy.com/https://raw.githubusercontent.com/The-Brotherhood-of-SCU/Bugaoshan/refs/heads/main/assets/academic_calendar.json';
const REMOTE =
  'https://raw.githubusercontent.com/The-Brotherhood-of-SCU/Bugaoshan/main/assets/academic_calendar.json';

function cachePath(): string {
  return join(app.getPath('userData'), 'academic-calendar.json');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 把紧凑格式（eventTypes 注册表 + e 映射）展开为统一结构；已是展开格式则原样读取。 */
export function expandCalendar(value: unknown): AcademicCalendar {
  if (typeof value !== 'object' || value === null) throw new Error('校历数据格式异常');
  const root = value as Record<string, unknown>;
  const semesters = Array.isArray(root.semesters) ? root.semesters : [];
  const types =
    typeof root.eventTypes === 'object' && root.eventTypes !== null
      ? (root.eventTypes as Record<string, { l?: unknown; t?: unknown }>)
      : null;

  const result: AcademicCalendarSemester[] = [];
  for (const raw of semesters) {
    if (typeof raw !== 'object' || raw === null) continue;
    const semester = raw as Record<string, unknown>;
    const events: AcademicCalendarEvent[] = [];
    if (types && typeof semester.e === 'object' && semester.e !== null) {
      for (const [key, value] of Object.entries(semester.e as Record<string, unknown>)) {
        const info = types[key];
        if (!info) continue;
        const label = text(info.l);
        if (!label) continue;
        if (typeof value === 'string') {
          events.push({ label, tag: text(info.t), date: value, endDate: null });
        } else if (Array.isArray(value) && value.length >= 2) {
          events.push({
            label,
            tag: text(info.t),
            date: text(value[0]),
            endDate: text(value[1]) || null,
          });
        }
      }
    } else if (Array.isArray(semester.events)) {
      for (const item of semester.events) {
        if (typeof item !== 'object' || item === null) continue;
        const event = item as Record<string, unknown>;
        const label = text(event.label);
        const date = text(event.date);
        if (!label || !date) continue;
        events.push({
          label,
          tag: text(event.tag),
          date,
          endDate: text(event.endDate) || null,
        });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    result.push({
      name: text(semester.n) || text(semester.name),
      startDate: text(semester.s) || text(semester.startDate),
      totalWeeks: Number(semester.w ?? semester.totalWeeks ?? 0) || 0,
      events,
    });
  }
  if (result.length === 0) throw new Error('校历中没有学期数据');
  return { semesters: result };
}

async function download(url: string): Promise<AcademicCalendar> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return expandCalendar(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

let cached: AcademicCalendar | null = null;

/** 网络优先（镜像 → 原站），失败回退本地缓存；都没有则报错。 */
export async function fetchAcademicCalendar(): Promise<AcademicCalendar> {
  if (cached) return cached;
  let lastError: unknown = null;
  for (const url of [MIRROR, REMOTE]) {
    try {
      const calendar = await download(url);
      cached = calendar;
      try {
        writeFileSync(cachePath(), JSON.stringify(calendar), 'utf8');
      } catch {
        // 缓存写失败不影响本次结果。
      }
      return calendar;
    } catch (error) {
      lastError = error;
    }
  }
  try {
    const restored = expandCalendar(JSON.parse(readFileSync(cachePath(), 'utf8')));
    cached = restored;
    return restored;
  } catch {
    throw new Error(
      `校历获取失败${lastError instanceof Error ? `：${lastError.message}` : ''}（网络不可用且无本地缓存）`,
    );
  }
}
