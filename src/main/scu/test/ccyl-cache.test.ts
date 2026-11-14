import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  principal: 'student-a' as string | null,
  files: new Map<string, string>(),
  search: vi.fn(),
  mine: vi.fn(),
  library: vi.fn(),
}));
vi.mock('electron', () => ({ app: { getPath: () => '/mock-data' } }));
vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    if (!mocks.files.has(path)) throw new Error('missing');
    return mocks.files.get(path);
  },
  writeFileSync: (path: string, data: string) => mocks.files.set(path, data),
  renameSync: (from: string, to: string) => {
    mocks.files.set(to, mocks.files.get(from)!);
    mocks.files.delete(from);
  },
  rmSync: (path: string) => mocks.files.delete(path),
}));
vi.mock('../identity', () => ({ identityState: () => ({ principal: mocks.principal }) }));
vi.mock('../api', () => ({
  scuCcylSearch: mocks.search,
  scuCcylMine: mocks.mine,
  scuCcylLibrary: mocks.library,
}));
import { clearCcylCache, resetCcylCacheSession, scuCcylSnapshot } from '../ccyl-cache';

beforeEach(() => {
  mocks.files.clear();
  mocks.principal = 'student-a';
  vi.clearAllMocks();
  resetCcylCacheSession();
  mocks.search.mockResolvedValue({
    ok: true,
    data: [{ id: '1', name: '活动', token: 'secret', photo: 'raw' }],
  });
});
describe('second classroom account snapshots', () => {
  it('persists only display fields and reads offline without API calls', async () => {
    const online = await scuCcylSnapshot({ kind: 'search', name: '' });
    expect(online.ok).toBe(true);
    expect([...mocks.files.values()].join('')).not.toMatch(/secret|photo|token/);
    const offline = await scuCcylSnapshot({ kind: 'search', name: '', offline: true });
    expect(offline).toMatchObject({
      ok: true,
      data: { offline: true, syncedAt: expect.any(String), data: [{ id: '1', name: '活动' }] },
    });
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });
  it('isolates accounts, queries, logout and clear', async () => {
    await scuCcylSnapshot({ kind: 'search' });
    expect((await scuCcylSnapshot({ kind: 'search', name: 'other', offline: true })).ok).toBe(
      false,
    );
    mocks.principal = 'student-b';
    expect((await scuCcylSnapshot({ kind: 'search', offline: true })).ok).toBe(false);
    await scuCcylSnapshot({ kind: 'search' });
    clearCcylCache();
    mocks.principal = 'student-a';
    expect((await scuCcylSnapshot({ kind: 'search', offline: true })).ok).toBe(true);
    mocks.principal = null;
    expect(await scuCcylSnapshot({ kind: 'search', offline: true })).toMatchObject({
      ok: false,
      auth: true,
    });
  });
  it('does not hide authentication or network errors behind saved success', async () => {
    await scuCcylSnapshot({ kind: 'search' });
    for (const auth of [true, false]) {
      mocks.search.mockResolvedValueOnce({ ok: false, auth, error: 'failed' });
      expect(await scuCcylSnapshot({ kind: 'search' })).toEqual({
        ok: false,
        auth,
        error: 'failed',
      });
    }
    expect((await scuCcylSnapshot({ kind: 'search', offline: true })).ok).toBe(true);
  });
  it('does not restore cache after clear or account change during a request', async () => {
    let resolve!: (value: unknown) => void;
    mocks.search.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = scuCcylSnapshot({ kind: 'search' });
    clearCcylCache();
    resolve({ ok: true, data: [] });
    expect(await pending).toMatchObject({ ok: false, auth: true });
    expect(mocks.files.size).toBe(0);
  });
  it('rejects results when the active account changes during a request', async () => {
    let resolve!: (value: unknown) => void;
    mocks.search.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = scuCcylSnapshot({ kind: 'search' });
    mocks.principal = 'student-b';
    resolve({ ok: true, data: [] });
    expect(await pending).toMatchObject({ ok: false, auth: true });
    expect(mocks.files.size).toBe(0);
  });
  it('stores library sessions without raw library payloads', async () => {
    mocks.library.mockResolvedValue({
      ok: true,
      data: {
        activityLib: { token: 'secret' },
        activities: [{ activityId: 'session', name: '场次' }],
        subscribed: true,
      },
    });
    await scuCcylSnapshot({ kind: 'library', id: 'lib' });
    expect(await scuCcylSnapshot({ kind: 'library', id: 'lib', offline: true })).toMatchObject({
      ok: true,
      data: { data: { activities: [{ activityId: 'session' }], subscribed: true } },
    });
    expect([...mocks.files.values()].join('')).not.toContain('secret');
  });
});
