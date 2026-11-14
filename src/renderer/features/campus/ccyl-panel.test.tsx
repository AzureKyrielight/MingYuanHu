// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DelaApi } from '../../../shared/api';
import { CcylPanel } from './campus-extra-panels';
let container: HTMLDivElement;
let root: Root;
const snapshot = vi.fn();
const clearCache = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  snapshot.mockReset();
  clearCache.mockReset();
  snapshot.mockImplementation(async (input: { kind: string; offline?: boolean }) => ({
    ok: true,
    data: {
      syncedAt: '2026-11-14T00:00:00.000Z',
      offline: !!input.offline,
      data:
        input.kind === 'library'
          ? { activities: [], subscribed: false }
          : [{ id: 'lib', name: '测试活动' }],
    },
  }));
  clearCache.mockResolvedValue({ ok: true, data: null });
  window.dela = {
    scu: { ccylSnapshot: snapshot, ccylClearCache: clearCache },
  } as unknown as DelaApi;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});
function button(text: string) {
  const result = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === text,
  );
  if (!result) throw new Error(`Missing ${text}`);
  return result;
}
it('shows offline timestamp, blocks mutations and requires clear confirmation', async () => {
  await act(async () => root.render(<CcylPanel />));
  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  expect(snapshot).toHaveBeenLastCalledWith({ kind: 'search', name: '', offline: true });
  expect(container.textContent).toContain('本地快照');
  await act(async () => button('场次').click());
  expect(button('订阅').disabled).toBe(true);
  await act(async () => button('清除缓存').click());
  expect(clearCache).not.toHaveBeenCalled();
  await act(async () => button('确认清除').click());
  expect(clearCache).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain('测试活动');
});
it('resets visible account data on identity change and ignores old pending results', async () => {
  let finish!: (value: unknown) => void;
  snapshot.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(<CcylPanel />));
  snapshot.mockResolvedValue({ ok: false, auth: true, error: '请先登录' });
  await act(async () => window.dispatchEvent(new Event('scu-identity-changed')));
  await act(async () =>
    finish({
      ok: true,
      data: {
        syncedAt: '2026-11-14T00:00:00.000Z',
        offline: false,
        data: [{ id: 'old', name: '旧账号活动' }],
      },
    }),
  );
  expect(container.textContent).toContain('请先登录');
  expect(container.textContent).not.toContain('旧账号活动');
});
