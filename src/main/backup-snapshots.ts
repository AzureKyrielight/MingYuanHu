// 本机快照的命名、过期判断与清理策略：纯函数，便于单测且与文件系统解耦。
import type { BackupAutoMode } from '../shared/backup';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** 快照目录名：本地时间 + 秒，避免同一天多次备份互相覆盖。 */
export function snapshotFolderName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('-');
  return `${date} ${time}`;
}

/** 是否该执行自动备份：关闭时永不触发；从未备份过则立即触发。 */
export function autoBackupDue(
  entries: readonly { createdAt: string }[],
  auto: BackupAutoMode,
  now: Date,
): boolean {
  if (auto === 'off') return false;
  const newest = entries[0];
  if (!newest) return true;
  const at = Date.parse(newest.createdAt);
  if (Number.isNaN(at)) return true;
  return now.getTime() - at >= (auto === 'daily' ? DAY_MS : WEEK_MS);
}

/** 超出保留份数的旧快照（entries 需按时间倒序），返回待删除项。 */
export function snapshotsToPrune<T extends { createdAt: string }>(
  entries: readonly T[],
  keep: number,
): T[] {
  if (keep <= 0) return [...entries];
  return entries.slice(keep);
}

/** 列表展示用的体积文案。 */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
