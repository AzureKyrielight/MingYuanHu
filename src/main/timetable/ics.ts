/** 最小 ICS（RFC 5545）生成：供课表 / 考表 / 校历导出使用，纯函数。 */
import { createHash } from 'node:crypto';

export interface IcsEvent {
  readonly title: string;
  /** 稳定 UID 种子（如 `lesson|semester|id`）。 */
  readonly seed: string;
  /** 全天事件用 YYYY-MM-DD；否则用 ISO 时间字符串（UTC 换算由本模块完成）。 */
  readonly start: string;
  /** 全天事件的结束日期为不含尾日的次日（YYYY-MM-DD）。 */
  readonly end: string;
  readonly allDay?: boolean;
  readonly location?: string | null;
  readonly description?: string | null;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function toUtcStamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`无效时间：${value}`);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function toDateStamp(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replace(/-/g, '');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`无效日期：${value}`);
  const pad = (part: number): string => String(part).padStart(2, '0');
  // 全天事件按上海时间（UTC+8）取日历日。
  const shanghai = new Date(date.getTime() + 8 * 3600_000);
  return `${shanghai.getUTCFullYear()}${pad(shanghai.getUTCMonth() + 1)}${pad(shanghai.getUTCDate())}`;
}

function uidOf(seed: string): string {
  return `${createHash('md5').update(seed).digest('hex')}@mingyuanhu`;
}

/** 按 RFC 5545 折行（每行不超过 75 字节）。 */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // 避免在 UTF-8 多字节字符中间截断。
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    const chunk = bytes.subarray(start, end).toString('utf8');
    parts.push(start === 0 ? chunk : ` ${chunk}`);
    start = end;
  }
  return parts.join('\r\n');
}

export function buildIcs(events: readonly IcsEvent[], calendarName = 'MingYuanHu'): string {
  const stamp = toUtcStamp(new Date().toISOString());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MingYuanHu//Campus Calendar//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uidOf(event.seed)}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toDateStamp(event.start)}`);
      lines.push(`DTEND;VALUE=DATE:${toDateStamp(event.end)}`);
    } else {
      lines.push(`DTSTART:${toUtcStamp(event.start)}`);
      lines.push(`DTEND:${toUtcStamp(event.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
