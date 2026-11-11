import { useEffect, useState } from 'react';
import { ArchiveRestore, DatabaseBackup } from 'lucide-react';
import type {
  BackupAutoMode,
  BackupEntry,
  BackupKeep,
  BackupSettings,
} from '../../../../shared/backup';
import { Button } from '../../../components/ui/button';
import { SettingsGroup } from '../SettingsGroup';
import { SettingRow } from '../SettingRow';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';

const autoLabels: Record<BackupAutoMode, string> = {
  off: '关闭',
  daily: '每天一次',
  weekly: '每周一次',
};

const selectClass = 'bg-transparent text-13 outline-none';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 通用 › 本机备份：快照只存放在「文档/明远湖备份」，恢复在下次启动时生效。
 * 与「导出数据」互补：导出给换机用，快照给本机回滚用。
 */
export function BackupControl() {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [snapshots, setSnapshots] = useState<BackupEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    // 浏览器预览与部分单测只注入部分 preload：缺 backup 时保持空态，不抛错。
    const api = window.dela?.backup;
    if (!api) {
      setSettings({ auto: 'off', keep: 5 });
      setSnapshots([]);
      return;
    }
    void Promise.all([api.getSettings(), api.listSnapshots()])
      .then(([nextSettings, nextSnapshots]) => {
        setSettings(nextSettings);
        setSnapshots(nextSnapshots);
      })
      .catch((cause: unknown) => setError(errorText(cause)));
  };

  useEffect(load, []);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = (patch: Partial<BackupSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    void run(async () => {
      const saved = await window.dela!.backup.saveSettings(next);
      setSettings(saved);
      // 改小保留份数后立即清理，用户不必等到下次备份才看到变化。
      setSnapshots(await window.dela!.backup.listSnapshots());
    });
  };

  const createSnapshot = () =>
    run(async () => {
      const entry = await window.dela!.backup.createSnapshot('manual');
      setSnapshots(await window.dela!.backup.listSnapshots());
      showToast({
        variant: 'success',
        title: '已生成本机快照',
        description: `${formatTime(entry.createdAt)} · ${formatBytes(entry.sizeBytes)}`,
      });
    });

  const restore = (entry: BackupEntry) =>
    run(async () => {
      const result = await window.dela!.backup.restoreSnapshot(entry.path);
      if (result.status === 'failed') {
        setError(result.reason);
        return;
      }
      showToast({
        variant: 'success',
        title: '已安排恢复',
        description: '完全退出并重新打开明远湖后，数据会回到这份快照。',
      });
    });

  return (
    <div className="grid gap-2">
      <SettingsGroup title="本机备份">
        <SettingRow settingId="backup-create" title="立即备份">
          <Button
            disabled={busy || !window.dela?.backup}
            onClick={() => void createSnapshot()}
            variant="outline"
          >
            <DatabaseBackup className="size-4" />
            生成快照
          </Button>
        </SettingRow>
        <SettingRow settingId="backup-auto" title="自动备份">
          <select
            aria-label="自动备份"
            className={selectClass}
            disabled={busy || !settings}
            onChange={(event) => saveSettings({ auto: event.target.value as BackupAutoMode })}
            value={settings?.auto ?? 'off'}
          >
            {(Object.keys(autoLabels) as BackupAutoMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {autoLabels[mode]}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow settingId="backup-keep" title="保留份数">
          <select
            aria-label="保留份数"
            className={selectClass}
            disabled={busy || !settings}
            onChange={(event) => saveSettings({ keep: Number(event.target.value) as BackupKeep })}
            value={settings?.keep ?? 5}
          >
            {[3, 5, 10].map((keep) => (
              <option key={keep} value={keep}>
                {keep} 份
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingsGroup>
      <div className="rounded-card border border-line">
        {snapshots === null ? (
          <p className="px-3 py-3 text-13 text-ink-3">正在读取快照…</p>
        ) : !snapshots.length ? (
          <p className="px-3 py-3 text-13 text-ink-3">还没有本机快照。</p>
        ) : (
          <ul className="divide-y divide-line">
            {snapshots.map((entry) => (
              <li className="flex items-center gap-3 px-3 py-2.5" key={entry.path}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-13">{formatTime(entry.createdAt)}</p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {entry.reason === 'scheduled' ? '自动备份' : '手动备份'} ·{' '}
                    {formatBytes(entry.sizeBytes)}
                  </p>
                </div>
                <Button
                  aria-label={`恢复到 ${formatTime(entry.createdAt)} 的快照`}
                  disabled={busy}
                  onClick={() => void restore(entry)}
                  size="sm"
                  variant="ghost"
                >
                  <ArchiveRestore className="size-4" />
                  恢复
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? (
        <p className="text-xs text-red" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-ink-3">
        快照保存在「文档/明远湖备份」，包含数据库（待办、设置、课表缓存）。恢复会在下次启动时覆盖当前数据。
      </p>
    </div>
  );
}
