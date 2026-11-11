import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { navEntries, useNavEntryPrefs } from '../../../navigation/entries';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { SettingsGroup } from '../SettingsGroup';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { SystemNotifications } from './SystemNotifications';
import { CacheUsage } from './CacheUsage';
import { BackupControl } from './BackupControl';
import { UpdateControl } from '../UpdateControl';

export function GeneralSection() {
  // null 表示尚未读到当前状态，开关保持禁用避免闪烁出错误的默认值。
  const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const hiddenEntries = useNavEntryPrefs((state) => state.hidden);
  const setEntryVisible = useNavEntryPrefs((state) => state.setVisible);

  useEffect(() => {
    void window.dela?.settings
      .getOpenAtLogin()
      .then(setOpenAtLogin)
      .catch(() => setOpenAtLogin(false));
  }, []);

  // 浏览器预览没有 preload，只维护选择态；桌面端经主进程持久化并同步系统启动项。
  const toggleOpenAtLogin = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      setOpenAtLogin(window.dela ? await window.dela.settings.setOpenAtLogin(next) : next);
    } catch (cause) {
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-10">
      <SectionHeader title="通用" />
      <div className="grid gap-2">
        <SettingsGroup title="启动">
          <SettingRow settingId="open-at-login" title="开机自启动">
            <Switch
              checked={openAtLogin ?? false}
              disabled={openAtLogin === null || busy}
              label="开机自启动"
              onChange={(next) => void toggleOpenAtLogin(next)}
            />
          </SettingRow>
        </SettingsGroup>
      </div>
      <div className="grid gap-2">
        <SettingsGroup settingId="nav-entries" title="导航入口">
          {navEntries.map((entry) => (
            <SettingRow key={entry.id} settingId={`nav-entry-${entry.id}`} title={entry.label}>
              <Switch
                checked={!hiddenEntries.includes(entry.id)}
                label={`在导航中显示${entry.label}`}
                onChange={(next) => setEntryVisible(entry.id, next)}
              />
            </SettingRow>
          ))}
        </SettingsGroup>
      </div>
      <SystemNotifications />
      <UpdateControl />
      <CacheUsage />
      <BackupControl />
    </div>
  );
}
