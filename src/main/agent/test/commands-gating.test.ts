// 明远湖的命令桥不暴露交大水源/课堂视频命令，川大校园命令可用。
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ shuiyuan: true }));
vi.mock('electron', () => ({
  ipcMain: {},
  app: { getPath: () => tmpdir(), isPackaged: false, getAppPath: () => tmpdir() },
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('../../settings/prefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../settings/prefs')>()),
  experimentEnabled: (key: string) => key !== 'shuiyuan' || flags.shuiyuan,
  assertShuiyuanEnabled: () => {
    if (!flags.shuiyuan) throw new Error('水源功能已关闭');
  },
}));
vi.mock('../../scu/api', () => ({
  scuGrades: vi.fn(),
  scuUserInfo: vi.fn(),
}));
import { scuGrades, scuUserInfo } from '../../scu/api';
import { startDomainBridge } from '../commands';

let bridge: Awaited<ReturnType<typeof startDomainBridge>>;
beforeAll(async () => {
  bridge = await startDomainBridge();
});
afterAll(() => bridge.close());
beforeEach(() => {
  flags.shuiyuan = true;
  vi.mocked(scuGrades).mockReset();
  vi.mocked(scuUserInfo).mockReset();
});

async function run(command: string, input: unknown = {}) {
  const response = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, input }),
  });
  return (await response.json()) as {
    ok: boolean;
    result?: unknown;
    error?: string;
    code?: string;
    parameters?: { properties: Record<string, unknown> };
    retryable?: boolean;
  };
}

it('offers opt-in domain summaries while preserving full and per-command help', async () => {
  const full = (await run('help')).result as { name: string; parameters: unknown }[];
  expect(full.every((item) => item.parameters)).toBe(true);
  const summary = (await run('help', { domain: 'scu', summary: true })).result as {
    name: string;
    parameters?: unknown;
  }[];
  expect(summary.length).toBeGreaterThan(0);
  expect(summary.every((item) => item.name.startsWith('scu_') && !item.parameters)).toBe(true);
  expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(full).length / 2);
  const selected = (await run('help', { command: 'scu_grades' })).result;
  expect(selected).toEqual([full.find((item) => item.name === 'scu_grades')]);
  expect((await run('help', { command: 'not_a_command' })).result).toEqual([]);
});

it('returns only the target schema on invalid input without invoking the API', async () => {
  const result = await run('scu_grades', { scheme: 'yes' });
  expect(result).toMatchObject({
    ok: false,
    code: 'INVALID_INPUT',
    error: '命令参数无效',
    issues: [{ path: ['scheme'] }],
    hint: expect.stringContaining('修正参数'),
  });
  expect(Object.keys(result.parameters!.properties)).toEqual(['scheme']);
  expect(scuGrades).not.toHaveBeenCalled();
  expect(await run('help', { summary: 'yes' })).toMatchObject({ code: 'INVALID_INPUT' });
});

it('marks expired authentication as non-retryable and does not retry the API', async () => {
  vi.mocked(scuUserInfo).mockResolvedValue({ ok: false, error: '登录已过期', auth: true });
  expect(await run('scu_whoami')).toMatchObject({
    ok: false,
    code: 'AUTH_EXPIRED',
    retryable: false,
    error: expect.stringContaining('登录已过期'),
    hint: expect.stringContaining('停止重试'),
  });
  expect(scuUserInfo).toHaveBeenCalledTimes(1);
});

it('preserves successful raw business JSON without truncation or projection', async () => {
  const data = {
    changingField: Array.from({ length: 300 }, (_, id) => ({ id, text: '成绩'.repeat(100) })),
  };
  vi.mocked(scuGrades).mockResolvedValue({ ok: true, data });
  expect(await run('scu_grades')).toEqual({ ok: true, result: data });
  expect(scuGrades).toHaveBeenCalledWith(false);
});

it('omits SJTU-only commands and exposes SCU commands', async () => {
  const names = async () =>
    ((await run('help')).result as { name: string }[]).map((item) => item.name);
  expect(await names()).not.toContain('search_shuiyuan_topics');
  expect(await names()).not.toContain('list_classroom_courses');
  expect(await names()).toContain('query_todos');
  expect(await names()).toContain('scu_grades');
  const result = await run('search_shuiyuan_topics', { query: '数据结构' });
  expect(result).toMatchObject({
    ok: false,
    error: '命令不存在：search_shuiyuan_topics，请使用 dela help',
  });
});
