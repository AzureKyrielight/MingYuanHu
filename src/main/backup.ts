import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { cp, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import {
  backupAutoModes,
  type BackupEntry,
  type BackupReason,
  type BackupResult,
  type BackupSettings,
  type RestoreResult,
} from '../shared/backup';
import { builtinSkillsDirectory } from './agent/skills';
import { autoBackupDue, snapshotFolderName, snapshotsToPrune } from './backup-snapshots';
import { cacheDirectoryNames } from './cache';
import { getDatabase } from './database';
import { checkWorkspaceSender } from './ipc';
import { readSetting, writeSetting } from './settings/prefs';
import { availablePath, storageDirectory } from './storage';

const databaseName = 'dela.db';

/** 本机快照目录放在「文档」下：与 userData 分离，才不会被 userData 的递归复制带进去。 */
function snapshotRoot(): string {
  return join(app.getPath('documents'), '明远湖备份');
}

function restoreMarker(): string {
  return join(app.getPath('userData'), 'restore-pending.json');
}

// 数据库走 VACUUM INTO 取一致快照；-wal/-shm 属于当前连接，跟着复制只会得到不自洽的副本。
const databaseFiles = new Set(['dela.db', 'dela.db-wal', 'dela.db-shm', 'dela.db-journal']);
// 备份只保留水源引用；快照和本机密钥不导出，恢复后尝试重新保存。
const skippedDataEntries = new Set([...databaseFiles, 'shuiyuan-snapshots']);

function backupFolderName(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
  return `明远湖光 备份 ${date} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

/** child 是否就在 parent 里面（含它本身）；同级不算。 */
function isInside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * 跳过符号链接，包括 Windows 上的 junction（pnpm 的 node_modules 就是）：实测没有开发者模式时
 * 复刻链接直接 EPERM，会连累整个顶层条目一个文件都复制不出来；而链接指向的内容本就不在这一层。
 */
async function skipLinks(source: string) {
  return !(await lstat(source)).isSymbolicLink();
}

/** 应用数据额外按名字跳过 Chromium 缓存（名单与设置里的「缓存占用」共用，见 `cache.ts`）；工作目录里叫 Cache 的目录可能是用户自己的东西。 */
async function skipCacheAndLinks(source: string) {
  if (cacheDirectoryNames.has(basename(source))) return false;
  return skipLinks(source);
}

/** 返回没复制成功的顶层条目名：界面据此如实告知，不假装备份完整。 */
export async function exportUserData(window: BrowserWindow | null): Promise<BackupResult> {
  const options = {
    title: '选择备份保存位置',
    buttonLabel: '导出到这里',
    properties: ['openDirectory', 'createDirectory'],
  } satisfies Electron.OpenDialogOptions;
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const parent = picked.filePaths[0];
  if (picked.canceled || !parent) return { status: 'cancelled' };

  const dataDirectory = app.getPath('userData');
  const workspace = storageDirectory();
  const skills = builtinSkillsDirectory();
  // 目标落在源目录里面会让导出边写边读自己（复制到一半才发现，还会留下半个文件夹）。
  for (const source of [dataDirectory, workspace, skills]) {
    if (isInside(source, parent)) {
      return { status: 'failed', reason: '不能保存到 明远湖光 的数据目录里，请另选一个位置' };
    }
  }

  const destination = availablePath(parent, backupFolderName(new Date()), true);
  const backupData = join(destination, '应用数据');
  await mkdir(backupData, { recursive: true });
  getDatabase().exec(`VACUUM INTO '${join(backupData, 'dela.db').replaceAll("'", "''")}'`);

  const skipped: string[] = [];
  for (const entry of await readdir(dataDirectory)) {
    if (skippedDataEntries.has(entry)) continue;
    try {
      await cp(join(dataDirectory, entry), join(backupData, entry), {
        recursive: true,
        filter: skipCacheAndLinks,
      });
    } catch {
      skipped.push(entry);
    }
  }

  // 工作目录（默认「文档/Dela」）与 userData 互不相干，各放一层，恢复时不会互相覆盖。
  if (existsSync(workspace)) {
    try {
      await cp(workspace, join(destination, '工作目录'), {
        recursive: true,
        filter: skipLinks,
      });
    } catch {
      skipped.push('工作目录');
    }
  }
  // 用户自己写的 Skill 与内置 Skill 同处 ~/.dela/skills，分不开，整层带走。
  if (existsSync(skills)) {
    try {
      await cp(skills, join(destination, '技能'), { recursive: true, filter: skipLinks });
    } catch {
      skipped.push('技能');
    }
  }
  return { status: 'exported', path: destination, skipped };
}

/** 导出只在条款接受页被调用：拒绝条款的用户也要能先把自己的数据拿走。 */
export function registerBackupIpc() {
  ipcMain.handle('backup:export', (event) => {
    checkWorkspaceSender(event);
    return exportUserData(BrowserWindow.fromWebContents(event.sender));
  });

  // 本机快照：设置 › 通用 › 备份。导出面向「搬到另一台机器」，快照面向「本机回滚」。
  for (const [channel, handler] of Object.entries({
    'backup:snapshot-create': () => createSnapshot('manual'),
    'backup:snapshot-list': () => listSnapshots(),
    'backup:snapshot-restore': (path: unknown) => scheduleRestore(path),
    'backup:settings-get': () => getBackupSettings(),
    'backup:settings-save': (input: unknown) => saveBackupSettings(input),
  })) {
    ipcMain.handle(channel, (event, input: unknown) => {
      checkWorkspaceSender(event);
      return handler(input);
    });
  }
}

// ---------------------------------------------------------------------------
// 本机快照（备份 / 恢复）
// ---------------------------------------------------------------------------

const backupAutoSchema = z.enum(backupAutoModes);
const backupKeepSchema = z.union([z.literal(3), z.literal(5), z.literal(10)]);
const defaultBackupSettings: BackupSettings = { auto: 'off', keep: 5 };

/** 偏好损坏时回退默认：备份是兜底能力，不该因为一个坏值就让入口失效。 */
export function getBackupSettings(): BackupSettings {
  return {
    auto: backupAutoSchema.catch(defaultBackupSettings.auto).parse(readSetting('backup-auto')),
    keep: backupKeepSchema
      .catch(defaultBackupSettings.keep)
      .parse(Number(readSetting('backup-keep'))),
  };
}

export function saveBackupSettings(input: unknown): BackupSettings {
  const settings = z.object({ auto: backupAutoSchema, keep: backupKeepSchema }).parse(input);
  writeSetting('backup-auto', settings.auto);
  writeSetting('backup-keep', String(settings.keep));
  return settings;
}

async function directorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

/** 快照按时间倒序；读不出 meta.json 的目录（手工放进来的杂物）直接忽略。 */
export async function listSnapshots(): Promise<BackupEntry[]> {
  const root = snapshotRoot();
  if (!existsSync(root)) return [];
  const entries: BackupEntry[] = [];
  for (const dirent of await readdir(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const path = join(root, dirent.name);
    try {
      const meta = JSON.parse(await readFile(join(path, 'meta.json'), 'utf8')) as {
        createdAt?: unknown;
        reason?: unknown;
      };
      if (typeof meta.createdAt !== 'string') continue;
      entries.push({
        path,
        createdAt: meta.createdAt,
        reason: meta.reason === 'scheduled' ? 'scheduled' : 'manual',
        sizeBytes: await directorySize(path),
      });
    } catch {
      continue;
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function availableSnapshotPath(now: Date): Promise<string> {
  const root = snapshotRoot();
  const base = snapshotFolderName(now);
  for (let index = 0; index < 100; index += 1) {
    const candidate = join(root, index === 0 ? base : `${base}-${index + 1}`);
    if (!existsSync(candidate)) return candidate;
  }
  return join(root, `${base}-${Date.now()}`);
}

/** 用 VACUUM INTO 取一致快照，再写 meta.json；完成后按保留份数清理旧快照。 */
export async function createSnapshot(reason: BackupReason = 'manual'): Promise<BackupEntry> {
  const now = new Date();
  await mkdir(snapshotRoot(), { recursive: true });
  const path = await availableSnapshotPath(now);
  await mkdir(path, { recursive: true });
  getDatabase().exec(`VACUUM INTO '${join(path, databaseName).replaceAll("'", "''")}'`);
  const createdAt = now.toISOString();
  await writeFile(join(path, 'meta.json'), JSON.stringify({ createdAt, reason }, null, 2), 'utf8');
  for (const old of snapshotsToPrune(await listSnapshots(), getBackupSettings().keep)) {
    await rm(old.path, { recursive: true, force: true });
  }
  return { path, createdAt, reason, sizeBytes: await directorySize(path) };
}

/** 恢复不能边跑边覆盖正在使用的数据库：写标记，下次启动时先替换再打开。 */
export async function scheduleRestore(path: unknown): Promise<RestoreResult> {
  const target = typeof path === 'string' ? path : '';
  if (!target || !isInside(snapshotRoot(), target))
    return { status: 'failed', reason: '只能恢复本机备份目录里的快照' };
  if (!existsSync(join(target, databaseName)))
    return { status: 'failed', reason: '快照里没有数据库文件，可能已被删除' };
  await writeFile(
    restoreMarker(),
    JSON.stringify({ path: target, scheduledAt: new Date().toISOString() }),
    'utf8',
  );
  return { status: 'scheduled', path: target };
}

/** 启动时在 getDatabase() 之前执行；恢复失败也删标记，避免每次启动都卡在同一份坏快照上。 */
export function applyPendingRestore(): void {
  const marker = restoreMarker();
  if (!existsSync(marker)) return;
  try {
    const pending = JSON.parse(readFileSync(marker, 'utf8')) as { path?: unknown };
    const path = typeof pending.path === 'string' ? pending.path : '';
    const source = join(path, databaseName);
    if (!path || !existsSync(source)) return;
    const dataDirectory = app.getPath('userData');
    // 先清掉旧库的 WAL/SHM：只替换主文件会让旧日志把旧内容又写回来。
    for (const suffix of ['-wal', '-shm', '-journal'])
      rmSync(join(dataDirectory, `${databaseName}${suffix}`), { force: true });
    copyFileSync(source, join(dataDirectory, databaseName));
  } finally {
    rmSync(marker, { force: true });
  }
}

/** 启动时调用：到点就悄悄备一份，失败只记日志，不打扰用户。 */
export function maybeAutoBackup(): void {
  const settings = getBackupSettings();
  if (settings.auto === 'off') return;
  void listSnapshots()
    .then((entries) => {
      if (autoBackupDue(entries, settings.auto, new Date())) return createSnapshot('scheduled');
      return undefined;
    })
    .catch((error: unknown) => console.error('Auto backup failed', error));
}
