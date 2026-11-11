import { describe, expect, it } from 'vitest';
import { buildIcs } from '../ics';

describe('buildIcs', () => {
  it('生成最小 VCALENDAR 并换算到 UTC', () => {
    const ics = buildIcs([
      {
        title: '高等数学',
        seed: 'lesson|2026-2027-1-1|1|2026-09-07T00:15:00.000Z',
        start: '2026-09-07T00:15:00.000Z',
        end: '2026-09-07T01:55:00.000Z',
        location: '江安一教A101',
      },
    ]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART:20260907T001500Z');
    expect(ics).toContain('DTEND:20260907T015500Z');
    expect(ics).toContain('SUMMARY:高等数学');
    expect(ics).toContain('LOCATION:江安一教A101');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // UID 稳定：同一 seed 多次生成一致。
    expect(
      buildIcs([
        { title: 'x', seed: 's', start: '2026-09-07T00:00:00Z', end: '2026-09-07T01:00:00Z' },
      ]),
    ).toBe(
      buildIcs([
        { title: 'x', seed: 's', start: '2026-09-07T00:00:00Z', end: '2026-09-07T01:00:00Z' },
      ]),
    );
  });

  it('全天事件用 DATE 值且结束日期不含尾日', () => {
    const ics = buildIcs([
      {
        title: '开学',
        seed: 'calendar|2026-2027|开学|2026-09-07',
        start: '2026-09-07',
        end: '2026-09-08',
        allDay: true,
      },
    ]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260907');
    expect(ics).toContain('DTEND;VALUE=DATE:20260908');
  });

  it('转义逗号、分号与换行', () => {
    const ics = buildIcs([
      {
        title: 'A,B;C\nD',
        seed: 'x',
        start: '2026-09-07T00:00:00Z',
        end: '2026-09-07T01:00:00Z',
      },
    ]);
    expect(ics).toContain('SUMMARY:A\\,B\\;C\\nD');
  });

  it('超长行按 75 字节折行', () => {
    const ics = buildIcs([
      {
        title: '很长的课程名称'.repeat(12),
        seed: 'x',
        start: '2026-09-07T00:00:00Z',
        end: '2026-09-07T01:00:00Z',
      },
    ]);
    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
  });

  it('无效时间直接报错', () => {
    expect(() =>
      buildIcs([{ title: 'x', seed: 's', start: 'not-a-date', end: '2026-09-07T01:00:00Z' }]),
    ).toThrow('无效时间');
  });
});
