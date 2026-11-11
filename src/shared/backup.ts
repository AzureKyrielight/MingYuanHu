/** 导出本机数据：复制到用户选定的位置，界面不做任何文件操作。 */
export interface BackupApi {
  exportData(): Promise<BackupResult>;
  /** 立即在本机备份目录（文档/明远湖备份）生成一份快照。 */
  createSnapshot(reason?: BackupReason): Promise<BackupEntry>;
  /** 已生成的快照，按时间倒序。 */
  listSnapshots(): Promise<BackupEntry[]>;
  /** 安排下次启动时用该快照覆盖当前数据；返回后提示用户重启。 */
  restoreSnapshot(path: string): Promise<RestoreResult>;
  /** 自动备份偏好。 */
  getSettings(): Promise<BackupSettings>;
  saveSettings(input: BackupSettings): Promise<BackupSettings>;
}

export type BackupResult =
  /**
   * skipped 是没能复制成功的顶层条目名，原因不止被占用（还可能是权限、磁盘空间、符号链接），
   * 所以只回报名字，让界面说「没复制成功」而不是断言原因。
   */
  | { status: 'exported'; path: string; skipped: string[] }
  | { status: 'cancelled' }
  /** 选定的位置不能用（例如落在 Dela 自己的数据目录里），reason 直接给用户看。 */
  | { status: 'failed'; reason: string };

export type BackupReason = 'manual' | 'scheduled';

export interface BackupEntry {
  /** 快照目录的绝对路径（恢复时按它定位）。 */
  path: string;
  /** ISO 时间，取自快照目录里的 meta.json。 */
  createdAt: string;
  reason: BackupReason;
  /** 快照目录总字节数，用于在列表里显示体积。 */
  sizeBytes: number;
}

/** 自动备份粒度：off 关闭，其余按「距上次快照超过相应时长」触发。 */
export const backupAutoModes = ['off', 'daily', 'weekly'] as const;
export type BackupAutoMode = (typeof backupAutoModes)[number];

export const backupKeepChoices = [3, 5, 10] as const;
export type BackupKeep = (typeof backupKeepChoices)[number];

export interface BackupSettings {
  auto: BackupAutoMode;
  keep: BackupKeep;
}

export type RestoreResult =
  { status: 'scheduled'; path: string } | { status: 'failed'; reason: string };
