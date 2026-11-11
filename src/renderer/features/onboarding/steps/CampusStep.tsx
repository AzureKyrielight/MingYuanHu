import { useState } from 'react';
import { DesktopOnlyNotice } from '../../../components/ui/desktop-only-notice';
import { connectAndSyncTimetable } from '../../timetable/timetable-connect';
import { StepButton, type StepButtonState } from './step-controls';

/** 向导 · 川大教务步骤：独立窗口完成统一身份认证并同步课表，按钮转为「下一步」。 */
export function CampusStep({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<StepButtonState>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="四川大学统一身份认证会话和本地课表缓存不会暴露给浏览器。"
        title="课表仅在明远湖桌面端可用"
      />
    );
  }

  const submit = async () => {
    if (state === 'success') return onDone();
    if (state === 'busy') return;
    setState('busy');
    setError(null);
    const failure = await connectAndSyncTimetable();
    if (failure) {
      setError(failure);
      setState('idle');
      return;
    }
    setState('success');
  };

  return (
    <div className="grid gap-7">
      <header className="grid gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">连接四川大学教务系统</h2>
        <p className="text-13 leading-relaxed text-ink-3">
          登录在独立窗口完成，明远湖只读取你的个人课表；这次统一身份认证会话也会用于成绩、电费等校园服务。
        </p>
      </header>
      {error && (
        <p className="text-13 [overflow-wrap:anywhere] text-red" role="alert">
          {error}
        </p>
      )}
      <StepButton
        busyLabel="等待登录…"
        idleLabel="登录并同步"
        onClick={() => void submit()}
        state={state}
        successLabel="连接成功，下一步"
        type="button"
      />
    </div>
  );
}
