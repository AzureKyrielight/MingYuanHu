import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, Mail, type LucideIcon } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { cn } from '../../../lib/utils';
import type { MailTrashRetention } from '../../../../shared/api';
import { SectionHeader } from '../SectionHeader';
import { SettingsGroup } from '../SettingsGroup';
import { errorText } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';

type ConnectionsSectionProps = {
  onOpenMail: () => void;
  onOpenTimetable: () => void;
};

type Connection = {
  /** 搜索直达与高亮目标（data-setting-id）。 */
  itemId: string;
  name: string;
  icon: LucideIcon;
  state: string;
  connected: boolean;
  actionLabel: string;
  onClick: () => void;
  /** 条目右侧的内联设置（如保留期）；仅在相应数据就绪时渲染。 */
  extra?: ReactNode;
};

/** 设置 › 连接：邮箱与川大教务两张连接卡的容器。 */
export function ConnectionsSection({ onOpenMail, onOpenTimetable }: ConnectionsSectionProps) {
  const [mailAddress, setMailAddress] = useState<string | null>(null);
  const [trashRetention, setTrashRetention] = useState<MailTrashRetention | null>(null);
  const [timetableSyncedAt, setTimetableSyncedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const dela = window.dela;
    if (!dela) return undefined;
    let active = true;
    void Promise.all([dela.mail.getState(), dela.timetable.getState()])
      .then(([mailState, timetableState]) => {
        if (!active) return;
        setMailAddress(mailState.account?.address ?? null);
        setTimetableSyncedAt(timetableState.lastSyncedAt);
        if (mailState.account) {
          void dela.mail
            .getTrashRetention()
            .then((value) => {
              if (active) setTrashRetention(value);
            })
            .catch(() => {});
        }
      })
      .catch((cause) => {
        if (active) setLoadError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  const changeRetention = async (value: MailTrashRetention) => {
    if (!window.dela || trashRetention === null) return;
    const previous = trashRetention;
    setTrashRetention(value);
    try {
      setTrashRetention(await window.dela.mail.setTrashRetention(value));
    } catch (cause) {
      setTrashRetention(previous);
      showToast({ variant: 'error', title: '保存保留期失败', description: errorText(cause) });
    }
  };

  const connections: Connection[] = [
    {
      itemId: 'mail',
      name: '学校邮箱',
      icon: Mail,
      state: mailAddress ? `已连接 · ${mailAddress}` : '未配置',
      connected: Boolean(mailAddress),
      actionLabel: '前往',
      onClick: onOpenMail,
      // 仅在邮箱已连接且保留期已读取时显示；浏览器预览无 window.dela，自然不渲染。
      extra:
        trashRetention === null ? undefined : (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink-3 max-md:hidden">已删除保留</span>
            <Select
              onValueChange={(value) => void changeRetention(Number(value) as MailTrashRetention)}
              value={String(trashRetention)}
            >
              <SelectTrigger aria-label="已删除邮件保留" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 天</SelectItem>
                <SelectItem value="30">30 天</SelectItem>
                <SelectItem value="90">90 天</SelectItem>
                <SelectItem value="0">永久</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ),
    },
    {
      itemId: 'timetable',
      name: '四川大学教务系统',
      icon: CalendarDays,
      state: timetableSyncedAt ? '已同步' : '未同步',
      connected: Boolean(timetableSyncedAt),
      actionLabel: '前往',
      onClick: onOpenTimetable,
    },
  ];

  return (
    <div className="grid gap-10">
      <SectionHeader title="连接" />
      {loadError && (
        <p className="text-xs text-red" role="alert">
          {loadError}
        </p>
      )}
      <SettingsGroup>
        <ul className="grid">
          {connections.map(
            ({ itemId, name, icon: Icon, state, connected, actionLabel, onClick, extra }) => (
              <li
                className="flex items-center justify-between gap-4 border-b py-3 last:border-0 max-md:items-start"
                data-setting-id={itemId}
                key={name}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-card bg-hover-2">
                    <Icon className="size-4 text-ink-3" strokeWidth={1.8} />
                  </span>
                  <div className="grid min-w-0 gap-0.5">
                    <strong className="text-13">{name}</strong>
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {extra}
                  {/* 状态用颜色说话：绿点=已连接，灰点=未连接；文字只补充细节。 */}
                  <span
                    className={cn(
                      'flex min-w-[4.5rem] max-w-40 items-center gap-1.5 text-xs max-md:min-w-0',
                      connected ? 'text-ink' : 'text-ink-3',
                    )}
                    title={state}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        connected ? 'bg-green' : 'bg-ink-3',
                      )}
                    />
                    <span className="truncate">{state}</span>
                  </span>
                  <Button className="shrink-0" onClick={onClick} size="sm" variant="secondary">
                    {actionLabel}
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      </SettingsGroup>
    </div>
  );
}
