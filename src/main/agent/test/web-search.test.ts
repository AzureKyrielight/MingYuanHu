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
  parseSogouWechatResults,
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

it('兼容必应结果的单引号属性与 class 顺序', () => {
  const html = `<LI data-x="1" CLASS='foo b_algo bar'><H2><A href='https://mp.weixin.qq.com/s/demo'>川大招聘 &amp; 宣讲</A></H2><DIV CLASS='b_caption extra'><P>线下宣讲&nbsp;地点</P></DIV></LI>`;
  expect(parseBingResults(html)).toEqual([
    { url: 'https://mp.weixin.qq.com/s/demo', title: '川大招聘 & 宣讲', snippet: '线下宣讲 地点' },
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

const bingPage = (items: { url: string; title: string }[]) =>
  items
    .map(
      ({ url, title }) =>
        `<li class="b_algo"><h2><a href="${url}">${title}</a></h2><div class="b_caption"><p>摘要</p></div></li>`,
    )
    .join('');

it('招聘模式展开多路查询，按来源排序去重并标注来源', async () => {
  const fetchMock = vi.fn(async (input: unknown) => {
    const query = new URL(String(input)).searchParams.get('q') ?? '';
    if (query.includes('site:mp.weixin.qq.com'))
      return new Response(
        bingPage([
          { url: 'https://mp.weixin.qq.com/s/a', title: '腾讯 网易 米哈游 宣讲 公众号推文' },
        ]),
      );
    if (query.includes('site:scu.edu.cn'))
      return new Response(
        bingPage([
          { url: 'https://job.scu.edu.cn/notice/1', title: '腾讯 网易 米哈游 宣讲 就业网公告' },
          { url: 'https://mp.weixin.qq.com/s/a', title: '重复的公众号推文' },
        ]),
      );
    return new Response(
      bingPage([
        { url: 'https://www.zhaopin.com/job/1', title: '腾讯 网易 米哈游 宣讲 招聘平台职位' },
        { url: 'https://example.com/news', title: '腾讯 网易 米哈游 宣讲 转载新闻' },
      ]),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await webSearch('腾讯 网易 米哈游 宣讲', 8, undefined, { mode: 'campus-recruit' });
  // 4 路通用查询 + 搜狗微信的两次尝试（结果页没有 .txt-box，判为未返回结果后重试一次）。
  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(result).toMatchObject({ mode: 'campus-recruit' });
  expect(result.queries).toEqual([
    '腾讯 网易 米哈游 宣讲',
    '腾讯 网易 米哈游 宣讲 宣讲会 双选会',
    'site:scu.edu.cn 腾讯 网易 米哈游 宣讲',
    'site:mp.weixin.qq.com 腾讯 网易 米哈游 宣讲',
  ]);
  expect(result.results.map(({ url, source }) => [url, source])).toEqual([
    ['https://job.scu.edu.cn/notice/1', 'official'],
    ['https://mp.weixin.qq.com/s/a', 'wechat'],
    ['https://www.zhaopin.com/job/1', 'job-board'],
    ['https://example.com/news', 'web'],
  ]);
  vi.unstubAllGlobals();
});

it('招聘模式部分查询失败时保留可用来源并说明缺了哪一路', async () => {
  const fetchMock = vi.fn(async (input: unknown) => {
    const query = new URL(String(input)).searchParams.get('q') ?? '';
    if (query.includes('site:mp.weixin.qq.com')) throw new Error('搜索失败（HTTP 429）');
    return new Response(bingPage([{ url: 'https://job.scu.edu.cn/x', title: '公告' }]));
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await webSearch('川大 游戏公司 宣讲', 5, undefined, { mode: 'campus-recruit' });
  expect(result.results[0]).toMatchObject({ url: 'https://job.scu.edu.cn/x', source: 'official' });
  expect(result.warnings?.some((item) => item.includes('HTTP 429'))).toBe(true);
  // 搜狗微信同样拿不到结果，但这只应作为警告，不能吞掉或污染其余来源。
  expect(result.warnings?.some((item) => item.includes('微信搜索'))).toBe(true);
  vi.unstubAllGlobals();
});

it('招聘模式全部查询失败时抛出首个错误', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  await expect(
    webSearch('川大 宣讲会 全失败', 5, undefined, { mode: 'campus-recruit' }),
  ).rejects.toThrow('network down');
  vi.unstubAllGlobals();
});

it('普通搜索不带 mode 时不展开也不标注来源', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(new Response(bingPage([{ url: 'https://example.com/a', title: 'A' }]))),
  );
  const result = await webSearch('普通查询', 3);
  expect(result.mode).toBeUndefined();
  expect(result.results).toEqual([{ url: 'https://example.com/a', title: 'A', snippet: '摘要' }]);
  vi.unstubAllGlobals();
});

it('政策模式展开官方域名与通知语义词查询并标注来源', async () => {
  const fetchMock = vi.fn(async (input: unknown) => {
    const query = new URL(String(input)).searchParams.get('q') ?? '';
    return new Response(
      bingPage([
        { url: 'https://cs.scu.edu.cn/info/1247/19388.htm', title: `学院通知 ${query}` },
        { url: 'https://www.zizzs.com/gk/x', title: `转载 ${query}` },
      ]),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await webSearch('四川大学计算机学院 2026届 推免 实施细则', 8, undefined, {
    mode: 'campus-policy',
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.queries).toEqual([
    '四川大学计算机学院 2026届 推免 实施细则',
    'site:scu.edu.cn 四川大学计算机学院 2026届 推免 实施细则',
    '四川大学计算机学院 2026届 推免 实施细则 通知 公示',
  ]);
  expect(result.results.map(({ url, source }) => [url, source])).toEqual([
    ['https://cs.scu.edu.cn/info/1247/19388.htm', 'official'],
    ['https://www.zizzs.com/gk/x', 'web'],
  ]);
  vi.unstubAllGlobals();
});

const soPage = (items: { url: string; title: string; snippet?: string }[]) =>
  items
    .map(
      ({ url, title, snippet }) =>
        `<li class="res-list" data-mdurl="${url}"><h3 class="res-title"><a href="https://www.so.com/link?m=x">${title}</a></h3><p class="res-desc">${snippet ?? '摘要'}</p></li>`,
    )
    .join('');

it('必应结果与查询不相关时自动改用 360 搜索并给出说明', async () => {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('cn.bing.com'))
      return new Response(bingPage([{ url: 'https://example.com/x', title: '无关百科' }]));
    if (url.includes('www.so.com'))
      return new Response(
        soPage([
          {
            url: 'https://cs.scu.edu.cn/info/1247/19388.htm',
            title: '学院关于推荐2026届优秀应届本科毕业生免试攻读研究生工作的通知',
            snippet: '根据教育部推免研究生工作指导意见…',
          },
        ]),
      );
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await webSearch('四川大学计算机学院 2026届 推免 实施细则', 5);
  expect(result.provider).toBe('so');
  expect(result.results[0]).toMatchObject({
    url: 'https://cs.scu.edu.cn/info/1247/19388.htm',
    snippet: '根据教育部推免研究生工作指导意见…',
  });
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings?.[0]).toContain('360');
  vi.unstubAllGlobals();
});

it('360 也失败时保留必应结果，不因降级丢失仅剩来源', async () => {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('www.so.com')) throw new Error('network down');
    return new Response(bingPage([{ url: 'https://example.com/x', title: '无关百科' }]));
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await webSearch('四川大学计算机学院 2026届 推免 名额 公示', 5);
  expect(result.provider).toBe('bing');
  expect(result.results[0]?.title).toBe('无关百科');
  expect(result.warnings).toBeUndefined();
  vi.unstubAllGlobals();
});

const sogouPage = (
  items: { title: string; snippet?: string; account?: string; href?: string; stamp?: string }[],
) =>
  `<html><body><ul class="news-list">${items
    .map(
      ({ title, snippet, account, href = '/link?url=abc&type=2', stamp = '1794408855' }) =>
        `<li id="sogou_vr_11002601_box_0"><div class="txt-box"><h3><a href="${href}" target="_blank">${title}</a></h3><p class="txt-info">${snippet ?? '摘要'}</p><div class="s-p" t="${stamp}"><a class="account" href="/mp?x">${account ?? '川大计算机软件就业'}</a></div></div></li>`,
    )
    .join('')}</ul></body></html>`;

it('解析搜狗微信结果页：标题、摘要、公众号与时间，跳过残缺与站外链接', () => {
  const html = sogouPage([
    {
      title: '11月12日川大专场宣讲会｜双选会｜<em>11月20日米哈游</em>活动信息一览',
      snippet: '米哈游招聘宣讲 2026-11-20 14:00 望江校区',
    },
    { title: '', snippet: '没有标题' },
    { title: '站外链接', href: 'https://evil.example/x' },
    { title: '空链接', href: '' },
  ]);
  const results = parseSogouWechatResults(html);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    title: '11月12日川大专场宣讲会｜双选会｜11月20日米哈游活动信息一览',
    snippet: '米哈游招聘宣讲 2026-11-20 14:00 望江校区',
    publisher: '川大计算机软件就业',
  });
  expect(results[0]!.url.startsWith('https://weixin.sogou.com/link?')).toBe(true);
  expect(results[0]!.publishedAt).toBe(new Date(1794408855 * 1000).toISOString());
});

it('招聘模式合并搜狗微信结果并按来源排序', async () => {
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input).includes('weixin.sogou.com'))
      return new Response(
        sogouPage([{ title: '11月20日米哈游活动信息一览', snippet: '宣讲 2026-11-20 14:00' }]),
      );
    return new Response(
      bingPage([
        { url: 'https://cs.scu.edu.cn/notice/1', title: '学院宣讲通知' },
        { url: 'https://example.com/news', title: '转载新闻' },
      ]),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await webSearch('米哈游 四川大学 活动', 8, undefined, { mode: 'campus-recruit' });
  expect(result.results.map(({ source }) => source)).toEqual(['official', 'wechat-search', 'web']);
  expect(result.results[1]).toMatchObject({
    title: '11月20日米哈游活动信息一览',
    publisher: '川大计算机软件就业',
    source: 'wechat-search',
  });
  expect(result.wechat).toMatchObject({ query: '米哈游 四川大学 活动', found: 1 });
  vi.unstubAllGlobals();
});

it('搜狗微信触发验证码时只记警告，不影响整体结果也不重试', async () => {
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input).includes('weixin.sogou.com'))
      return new Response(
        '<html><title>搜狗搜索</title><body>请输入验证码，此验证码用于确认这些请求是您的正常行为</body></html>',
      );
    return new Response(bingPage([{ url: 'https://cs.scu.edu.cn/notice/1', title: '学院通知' }]));
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await webSearch('米哈游 四川大学 活动', 5, undefined, { mode: 'campus-recruit' });
  expect(result.results.map(({ source }) => source)).toEqual(['official']);
  expect(result.warnings?.some((item) => item.includes('微信搜索'))).toBe(true);
  expect(result.wechat).toMatchObject({ error: '微信搜索触发验证码，未取得结果' });
  expect(
    fetchMock.mock.calls.filter(([input]) => String(input).includes('weixin.sogou.com')),
  ).toHaveLength(1);
  vi.unstubAllGlobals();
});
