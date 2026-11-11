import { describe, expect, it } from 'vitest';
import {
  autoBackupDue,
  formatBytes,
  snapshotFolderName,
  snapshotsToPrune,
} from '../backup-snapshots';

const entry = (createdAt: string) => ({ createdAt });

describe('snapshotFolderName', () => {
  it('uses local time with second precision', () => {
    expect(snapshotFolderName(new Date(2026, 10, 11, 21, 5, 7))).toBe('2026-11-11 21-05-07');
  });
});

describe('autoBackupDue', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');

  it('never triggers when disabled', () => {
    expect(autoBackupDue([], 'off', now)).toBe(false);
  });

  it('triggers when there is no snapshot yet', () => {
    expect(autoBackupDue([], 'daily', now)).toBe(true);
  });

  it('respects daily and weekly windows', () => {
    const recent = [entry('2026-11-11T00:00:00.000Z')];
    const twoDaysAgo = [entry('2026-11-09T12:00:00.000Z')];
    expect(autoBackupDue(recent, 'daily', now)).toBe(false);
    expect(autoBackupDue(twoDaysAgo, 'daily', now)).toBe(true);
    expect(autoBackupDue(twoDaysAgo, 'weekly', now)).toBe(false);
  });

  it('treats unreadable timestamps as due instead of silently stopping', () => {
    expect(autoBackupDue([entry('坏时间')], 'daily', now)).toBe(true);
  });
});

describe('snapshotsToPrune', () => {
  const entries = [
    entry('2026-11-11T00:00:00.000Z'),
    entry('2026-11-10T00:00:00.000Z'),
    entry('2026-11-09T00:00:00.000Z'),
  ];

  it('keeps the newest entries', () => {
    expect(snapshotsToPrune(entries, 2)).toEqual([entries[2]]);
    expect(snapshotsToPrune(entries, 5)).toEqual([]);
  });
});

describe('formatBytes', () => {
  it('formats sizes with sensible units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
