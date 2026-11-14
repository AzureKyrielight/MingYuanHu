// 搜索服务多条目存储：新建即选中、删除回落与选择联动工具开关。
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, it, vi } from 'vitest';

let database: DatabaseSync;
const capabilityCalls: { names: string[]; enabled: boolean }[] = [];
vi.mock('../../database', () => ({ getDatabase: () => database }));
vi.mock('../tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tools')>();
  return {
    ...actual,
    setBuiltinCapabilities: (names: string[], enabled: boolean) => {
      capabilityCalls.push({ names, enabled });
      return actual.setBuiltinCapabilities(names, enabled);
    },
  };
});
vi.mock('../../credentials', () => ({
  loadLlmConfig: () => ({
    providers: [
      {
        id: 'p1',
        name: 'DeepSeek 官方',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-school',
        enabled: true,
      },
      {
        id: 'p2',
        name: '中转',
        baseUrl: 'https://relay.example/v1',
        apiKey: 'sk-relay',
        enabled: true,
      },
    ],
  }),
}));
import {
  listWebSearchEntries,
  listWebSearchKeySources,
  listWebSearchOptions,
  parseBingResults,
  readWebSearchConfig,
  readWebSearchKey,
  removeWebSearchEntry,
  saveWebSearchEntry,
  selectWebSearchEntry,
  webSearch,
} from '../web-search';

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  capabilityCalls.length = 0;
});

it('新建即选中，更新已有条目不改选中', () => {
  const brave = saveWebSearchEntry({ name: 'Brave', provider: 'brave', apiKey: 'BSA-1' })[0]!;
  expect(readWebSearchConfig()?.id).toBe(brave.id);
  const deep = saveWebSearchEntry({
    name: '学校账号',
    provider: 'deepseek',
    apiKey: 'sk-1',
    useForFetch: false,
  }).find(({ name }) => name === '学校账号')!;
  expect(readWebSearchConfig()?.id).toBe(deep.id);
  selectWebSearchEntry(brave.id);
  saveWebSearchEntry({
    id: deep.id,
    name: '学校账号',
    provider: 'deepseek',
    apiKey: 'sk-2',
    useForFetch: true,
  });
  expect(readWebSearchConfig()?.id).toBe(brave.id);
  expect(listWebSearchEntries().find(({ id }) => id === deep.id)).toMatchObject({
    apiKey: 'sk-2',
    useForFetch: true,
  });
});

it('删除选中条目时回落到剩余第一条，删空后停用 web_search', () => {
  const a = saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' })[0]!;
  saveWebSearchEntry({ name: 'B', provider: 'deepseek', apiKey: 'sk-1', useForFetch: false });
  // 新建 B 抢走了选中，先选回 A 再删 A，才会走到「回落到剩余第一条」分支。
  selectWebSearchEntry(a.id);
  const remaining = removeWebSearchEntry(a.id);
  expect(remaining).toHaveLength(1);
  expect(readWebSearchConfig()?.name).toBe('B');
  removeWebSearchEntry(remaining[0]!.id);
  expect(readWebSearchConfig()).toBeNull();
  expect(capabilityCalls.at(-1)).toEqual({ names: ['web_search'], enabled: false });
});

it('选择条目即视为要用搜索，顺带启用 web_search 工具', () => {
  const entry = saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' })[0]!;
  capabilityCalls.length = 0;
  selectWebSearchEntry(entry.id);
  expect(capabilityCalls).toEqual([{ names: ['web_search'], enabled: true }]);
  expect(() => selectWebSearchEntry('00000000-0000-4000-8000-000000000000')).toThrow(/不存在/);
});

it('聊天侧选「关闭」即清空选中并关掉 web_search 工具', () => {
  saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' });
  capabilityCalls.length = 0;
  selectWebSearchEntry(null);
  expect(readWebSearchConfig()).toBeNull();
  expect(capabilityCalls).toEqual([{ names: ['web_search'], enabled: false }]);
});

it('设置里新建即选中并启用 web_search，删空自动停用', () => {
  const list = saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' });
  expect(readWebSearchConfig()?.id).toBe(list[0]!.id);
  expect(capabilityCalls).toEqual([{ names: ['web_search'], enabled: true }]);
  removeWebSearchEntry(list[0]!.id);
  expect(readWebSearchConfig()).toBeNull();
  expect(capabilityCalls).toEqual([
    { names: ['web_search'], enabled: true },
    { names: ['web_search'], enabled: false },
  ]);
});

it('更新时传入已删除的 id 会报错，不会按新建复活条目', () => {
  saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' });
  expect(() =>
    saveWebSearchEntry({
      id: '00000000-0000-4000-8000-000000000000',
      name: '幽灵',
      provider: 'brave',
      apiKey: 'BSA-2',
    }),
  ).toThrow(/不存在/);
  expect(listWebSearchEntries()).toHaveLength(1);
});

it('上限只拒绝真正新增，编辑已有条目不受限', () => {
  let list: ReturnType<typeof listWebSearchEntries> = [];
  for (let i = 0; i < 16; i++)
    list = saveWebSearchEntry({ name: `S${i}`, provider: 'brave', apiKey: 'BSA-1' });
  expect(() => saveWebSearchEntry({ name: 'S16', provider: 'brave', apiKey: 'BSA-1' })).toThrow(
    /16/,
  );
  saveWebSearchEntry({ id: list[0]!.id, name: 'S0 改', provider: 'brave', apiKey: 'BSA-2' });
  expect(listWebSearchEntries()).toHaveLength(16);
});

it('聊天侧选择器数据脱敏且不含密钥', () => {
  saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' });
  const options = listWebSearchOptions();
  expect(options.entries).toEqual([
    { id: readWebSearchConfig()!.id, name: 'A', provider: 'brave' },
  ]);
  expect(options.selectedId).toBe(readWebSearchConfig()!.id);
  expect(JSON.stringify(options)).not.toContain('BSA-1');
});

it('设置中禁用搜索工具后，聊天选择器应显示关闭', async () => {
  const { setBuiltinCapabilities, readDisabledTools } =
    await vi.importActual<typeof import('../tools')>('../tools');
  const entry = saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' })[0]!;
  setBuiltinCapabilities(['web_search'], true);
  expect(listWebSearchOptions().selectedId).toBe(entry.id);

  setBuiltinCapabilities(['web_search'], false);

  expect(readDisabledTools().has('web_search')).toBe(true);
  expect(listWebSearchOptions().selectedId).toBeNull();
});

it('密钥导入只认官方端点且中转网关不算 DeepSeek', () => {
  const sources = listWebSearchKeySources();
  expect(sources).toEqual([{ id: 'p1', name: 'DeepSeek 官方' }]);
  expect(readWebSearchKey('p1')).toBe('sk-school');
  expect(readWebSearchKey('p2')).toBeNull();
});

it('解析必应结果页的标题、链接与摘要', () => {
  const html = `
    <li class="b_algo"><h2><a target="_blank" href="https://example.com/a" h="ID=1">示例 <strong>A</strong></a></h2>
      <div class="b_caption"><p class="b_lineclamp2">摘要&nbsp;A&ensp;正文</p></div></li>
    <li class="b_algo"><h2><a href="https://example.com/b">示例 B</a></h2>
      <div class="b_caption"><p>摘要 B</p></div></li>
    <li class="b_algo"><h2><a href="https://example.com/c">无摘要</a></h2></li>`;
  expect(parseBingResults(html)).toEqual([
    { url: 'https://example.com/a', title: '示例 A', snippet: '摘要 A 正文' },
    { url: 'https://example.com/b', title: '示例 B', snippet: '摘要 B' },
    { url: 'https://example.com/c', title: '无摘要', snippet: '' },
  ]);
});

it('没配搜索服务时自动回退到免密钥的必应网页版', async () => {
  expect(readWebSearchConfig()).toBeNull();
  const html = `<li class="b_algo"><h2><a href="https://example.com/a">示例</a></h2>
    <div class="b_caption"><p>摘要</p></div></li>`;
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(html, { headers: { 'content-type': 'text/html' } }));
  vi.stubGlobal('fetch', fetchMock);
  const result = await webSearch('示例 查询', 3);
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain('cn.bing.com/search');
  expect(result).toMatchObject({ provider: 'bing', fallback: true });
  expect(result.results).toEqual([
    { url: 'https://example.com/a', title: '示例', snippet: '摘要' },
  ]);
  vi.unstubAllGlobals();
});

it('缓存合并并按域名过滤结果，同时限制摘要长度', async () => {
  const html = `<li class="b_algo"><h2><a href="https://example.com/a">A</a></h2><div class="b_caption"><p>${'x'.repeat(700)}</p></div></li>
    <li class="b_algo"><h2><a href="https://other.test/b">B</a></h2></li>`;
  const fetchMock = vi.fn().mockResolvedValue(new Response(html));
  vi.stubGlobal('fetch', fetchMock);
  const first = await webSearch('缓存测试', 5, undefined, { domains: ['example.com'] });
  const second = await webSearch('缓存测试', 5, undefined, { domains: ['example.com'] });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(second.cacheHit).toBe(true);
  expect(first.results).toHaveLength(1);
  expect(first.results[0]!.snippet).toHaveLength(500);
  expect(first.fetchedAt).toBeTypeOf('number');
  vi.unstubAllGlobals();
});

it('切换搜索配置不会复用另一供应商的缓存', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => {
    const title = fetchMock.mock.calls.length === 1 ? 'A' : 'B';
    return new Response(
      JSON.stringify({
        grounding: { generic: [{ url: `https://${title}.example/a`, title, snippets: ['摘要'] }] },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  saveWebSearchEntry({ name: 'A', provider: 'brave', apiKey: 'BSA-1' });
  const first = await webSearch('配置切换', 3);
  const second = await webSearch('配置切换', 3);
  expect(second.cacheHit).toBe(true);
  saveWebSearchEntry({ name: 'B', provider: 'brave', apiKey: 'BSA-2' });
  const switched = await webSearch('配置切换', 3);
  expect(switched.cacheHit).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(switched.results).not.toEqual(first.results);
  vi.unstubAllGlobals();
});

it('刷新请求不会被旧请求结果覆盖，且刷新期间普通请求复用旧缓存', async () => {
  let releaseOld!: () => void;
  let releaseRefresh!: () => void;
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const fetchMock = vi.fn().mockImplementation(async () => {
    const call = fetchMock.mock.calls.length;
    if (call === 1) await oldGate;
    if (call === 2) await refreshGate;
    const name = call === 1 ? 'old' : 'new';
    return new Response(
      `<li class="b_algo"><h2><a href="https://example.com/${name}">结果</a></h2></li>`,
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const old = webSearch('刷新测试', 3);
  await Promise.resolve();
  const refresh = webSearch('刷新测试', 3, undefined, { refresh: true });
  await Promise.resolve();
  releaseRefresh();
  const fresh = await refresh;
  expect(fresh.results[0]?.url).toContain('/new');
  releaseOld();
  const stale = await old;
  expect(stale.results[0]?.url).toContain('/old');
  const after = await webSearch('刷新测试', 3);
  expect(after.cacheHit).toBe(true);
  expect(after.results[0]?.url).toContain('/new');
  vi.unstubAllGlobals();
});

it('必应回退解析为空时报错并引导手动配置', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response('<html>无结果</html>', { headers: { 'content-type': 'text/html' } }),
      ),
  );
  await expect(webSearch('示例', 3)).rejects.toThrow(/配置搜索服务/);
  vi.unstubAllGlobals();
});
