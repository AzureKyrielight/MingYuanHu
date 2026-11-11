import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { AcademicCalendar } from '../../../shared/api';
import { Button } from '../../components/ui/button';
import { dialogIn, overlayFade } from '../../components/ui/motion';
import { errorText } from '../../workspace/store';
import { cn } from '../../lib/utils';

/** 校历：浏览学期事件、导入本地日历、导出课表/考表/日历为 ICS。 */
export function AcademicCalendarDialog({
  semester,
  onClose,
  onImported,
}: {
  semester: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [calendar, setCalendar] = useState<AcademicCalendar | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const next = await window.dela!.timetable.academicCalendar();
        setCalendar(next);
        const match = next.semesters.find((item) => semester.startsWith(item.name.slice(0, 9)));
        setSelected((match ?? next.semesters[0])?.name ?? '');
      } catch (reason) {
        setError(errorText(reason));
      }
    })();
  }, [semester]);

  const current = useMemo(
    () => calendar?.semesters.find((item) => item.name === selected) ?? calendar?.semesters[0],
    [calendar, selected],
  );

  const importEvents = async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.dela!.timetable.importAcademicCalendar(current.name);
      setMessage(`已导入 ${result.imported} 个校历事件到本地日历`);
      onImported();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const exportIcs = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.dela!.timetable.exportIcs(semester);
      setMessage(`已导出 ${result.events} 个事件到 ${result.path}`);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-modal="true"
      className={cn(overlayFade, 'fixed inset-0 z-50 grid place-items-center bg-black/30 p-4')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div
        className={cn(
          dialogIn,
          'flex max-h-[80vh] w-full max-w-[34rem] flex-col gap-3 rounded-window bg-surface p-5 shadow-overlay',
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">校历</h2>
          <Button aria-label="关闭" onClick={onClose} size="icon-sm" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>

        {calendar && (
          <select
            className="h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={current?.name ?? ''}
            onChange={(event) => setSelected(event.target.value)}
          >
            {calendar.semesters.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        )}

        {error && <p className="text-sm text-red">{error}</p>}
        {message && <p className="break-all text-sm text-ink-2">{message}</p>}

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line">
          {current ? (
            <ul className="divide-y divide-line/70 text-sm">
              {current.events.map((event, index) => (
                <li
                  key={`${event.label}-${event.date}-${index}`}
                  className="flex items-baseline justify-between gap-3 px-3 py-2"
                >
                  <span className="text-ink">{event.label}</span>
                  <span className="shrink-0 text-xs text-ink-3">
                    {event.date}
                    {event.endDate && event.endDate !== event.date ? ` ~ ${event.endDate}` : ''}
                  </span>
                </li>
              ))}
              {current.events.length === 0 && (
                <li className="px-3 py-2 text-sm text-ink-3">该学期没有校历事件。</li>
              )}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-ink-3">正在获取校历…</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            disabled={busy || !current}
            onClick={() => void importEvents()}
            size="sm"
            variant="ghost"
          >
            {busy ? '处理中…' : '导入到日历'}
          </Button>
          <Button disabled={busy} onClick={() => void exportIcs()} size="sm">
            导出 ICS（课表 + 考表 + 日历）
          </Button>
        </div>
      </div>
    </div>
  );
}
