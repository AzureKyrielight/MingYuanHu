import { describe, expect, it, vi } from 'vitest';
import { expandCalendar } from '../academic-calendar';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}));

describe('expandCalendar', () => {
  it('把紧凑格式（eventTypes + e）展开并按日期排序', () => {
    const calendar = expandCalendar({
      eventTypes: {
        a: { l: '开学', t: 'term' },
        b: { l: '考试周', t: 'exam' },
      },
      semesters: [
        {
          n: '2026-2027学年秋',
          s: '2026-09-07',
          w: 20,
          e: { b: ['2027-01-04', '2027-01-15'], a: '2026-09-07' },
        },
      ],
    });
    expect(calendar.semesters).toHaveLength(1);
    expect(calendar.semesters[0]).toEqual({
      name: '2026-2027学年秋',
      startDate: '2026-09-07',
      totalWeeks: 20,
      events: [
        { label: '开学', tag: 'term', date: '2026-09-07', endDate: null },
        { label: '考试周', tag: 'exam', date: '2027-01-04', endDate: '2027-01-15' },
      ],
    });
  });

  it('已展开格式原样读取', () => {
    const calendar = expandCalendar({
      semesters: [
        {
          name: '2025-2026学年春',
          startDate: '2026-02-23',
          totalWeeks: 20,
          events: [{ label: '开学', tag: 'term', date: '2026-02-23' }],
        },
      ],
    });
    expect(calendar.semesters[0]?.events[0]).toMatchObject({ label: '开学', endDate: null });
  });

  it('没有学期数据时报错', () => {
    expect(() => expandCalendar({ semesters: [] })).toThrow('没有学期数据');
    expect(() => expandCalendar(null)).toThrow('格式异常');
  });
});
