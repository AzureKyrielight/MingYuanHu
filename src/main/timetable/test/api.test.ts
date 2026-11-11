import { describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { deleteCalendarEvent, parseWeekNumbers, semesterStartFromWeek } from '../api';
import { getDatabase } from '../../database';

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {},
  session: {},
  net: { request: vi.fn() },
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));

describe('parseWeekNumbers', () => {
  it('expands ranges and comma-separated weeks', () => {
    expect(parseWeekNumbers('1-4,7周')).toEqual([1, 2, 3, 4, 7]);
  });

  it('respects odd and even week markers', () => {
    expect(parseWeekNumbers('1-8周(单)')).toEqual([1, 3, 5, 7]);
    expect(parseWeekNumbers('2-8周(双)')).toEqual([2, 4, 6, 8]);
  });
});

describe('semesterStartFromWeek', () => {
  it('returns the Monday of the given teaching week', () => {
    // 2026-11-11 是周三；第 10 周 → 2026-09-07（周一）。
    expect(semesterStartFromWeek(10, new Date(2026, 10, 11))).toBe('2026-09-07');
    // 第 1 周且当天是周一 → 当天。
    expect(semesterStartFromWeek(1, new Date(2026, 8, 7))).toBe('2026-09-07');
    // 跨年：2027-02-24 第 1 周 → 2027-02-22。
    expect(semesterStartFromWeek(1, new Date(2027, 1, 24))).toBe('2027-02-22');
  });

  it('rejects invalid week numbers', () => {
    expect(semesterStartFromWeek(0)).toBeNull();
    expect(semesterStartFromWeek(-3)).toBeNull();
    expect(semesterStartFromWeek(2.5)).toBeNull();
  });
});

describe('deleteCalendarEvent', () => {
  it('deletes only from calendar_events with a validated id', () => {
    const run = vi.fn();
    const prepare = vi.fn(() => ({ run }));
    vi.mocked(getDatabase).mockReturnValue({ prepare } as unknown as Database);
    deleteCalendarEvent(7);
    expect(prepare).toHaveBeenCalledWith('DELETE FROM calendar_events WHERE id = ?');
    expect(run).toHaveBeenCalledWith(7);
    expect(() => deleteCalendarEvent(0)).toThrow();
    expect(() => deleteCalendarEvent(2.5)).toThrow();
    expect(() => deleteCalendarEvent('3')).toThrow();
    expect(prepare).toHaveBeenCalledOnce();
  });
});
