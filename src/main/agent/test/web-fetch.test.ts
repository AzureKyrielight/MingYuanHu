import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchWebPage } from '../web-fetch';
import { releaseDocumentResource } from '../../resources';
import { assertDocumentDependency } from '../../documents/runtime';

const profile = vi.hoisted(() => ({ root: '' }));
profile.root = mkdtempSync(join(tmpdir(), 'dela-web-document-'));
vi.mock('electron', () => ({ app: { getPath: () => profile.root } }));
vi.mock('../../documents/runtime', () => ({
  DOCUMENT_SKILL: 'document-reading',
  assertDocumentDependency: vi.fn(),
  documentPython: () => 'component/python.exe',
}));
vi.mock('../../canvas/api', () => ({}));
vi.mock('../../workspace/api', () => ({}));
vi.mock('../../mail/api', () => ({}));
vi.mock('../../shuiyuan/api', () => ({}));
vi.mock('../../storage', () => ({}));

let testTime = Date.now();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime((testTime += 6 * 60 * 1000));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(() => rm(profile.root, { recursive: true, force: true }));

describe('web_fetch', () => {
  it('保留标题、链接、表格与代码，过滤导航和脚本', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          `
      <html><head><title>资料 &amp; 示例</title></head><body>
      <nav>导航内容</nav><main><h1>说明</h1><p><a href="./guide">指南</a></p>
      <table><tr><th>名称</th><th>价格</th></tr><tr><td>A</td><td>免费</td></tr></table>
      <pre><code class="language-js">const x = 1;</code></pre>
      <script>脚本内容</script></main><footer>页脚内容</footer></body></html>
    `,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
      ),
    );
    const page = await fetchWebPage('https://example.com/docs/page');
    expect(page.title).toBe('资料 & 示例');
    expect(page.text).toContain('# 说明');
    expect(page.text).toContain('[指南](https://example.com/docs/guide)');
    expect(page.text).toContain('| 名称 | 价格 |');
    expect(page.text).toContain('```js\nconst x = 1;\n```');
    expect(page.text).not.toMatch(/导航内容|脚本内容|页脚内容/);
  });

  it('保留无标题正文、article header 和定位布局内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          `
      <p>无标题正文</p><article><header><h1>文章标题</h1></header>
      <div class="sticky">定位正文</div><aside>补充资料</aside></article>
    `,
          { headers: { 'content-type': 'text/html' } },
        ),
      ),
    );
    const page = await fetchWebPage('https://example.com');
    for (const content of ['无标题正文', '文章标题', '定位正文', '补充资料']) {
      expect(page.text).toContain(content);
    }
  });

  it('相对链接基于重定向后的地址解析，Markdown 可按 offset 续读', async () => {
    const html = '<p><a href="guide">指南</a></p><p>' + '正文'.repeat(11000) + '</p>';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (url: URL) =>
          url.pathname === '/start'
            ? new Response(null, { status: 302, headers: { location: '/docs/page' } })
            : new Response(html, { headers: { 'content-type': 'text/html' } }),
        ),
    );
    const first = await fetchWebPage('https://example.com/start');
    const second = await fetchWebPage('https://example.com/start', first.nextOffset!);
    expect(first.source.url).toBe('https://example.com/docs/page');
    expect(first.text).toContain('[指南](https://example.com/docs/guide)');
    expect(first.nextOffset).toBe(20000);
    expect(second.nextOffset).toBeNull();
    expect((first.text + second.text).length).toBe(first.totalCharacters);
    expect(first.truncated).toBe(false);
  });

  it('纯文本保持原样，PDF 返回完整临时任务而不在主进程解析', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('普通 <文本>', { headers: { 'content-type': 'text/plain' } }),
        )
        .mockResolvedValueOnce(
          new Response('%PDF-', { headers: { 'content-type': 'application/pdf' } }),
        ),
    );
    expect((await fetchWebPage('https://example.com/text')).text).toBe('普通 <文本>');
    const pdf = await fetchWebPage('https://example.com/file.pdf');
    expect(pdf).toMatchObject({
      title: null,
      text: '',
      readable: false,
      nextOffset: null,
      truncated: false,
      document: { python: 'component/python.exe', jobId: expect.stringMatching(/^job-/) },
    });
    expect(await readFile(pdf.document!.input, 'utf8')).toBe('%PDF-');
    await releaseDocumentResource(pdf.document!.jobId);
  });

  it('识别分块响应中的 PDF 文件头，并保留超过网页 2 MiB 上限的完整文件', async () => {
    const contents = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(2 * 1024 * 1024 + 10, 65),
    ]);
    const chunks = [contents.subarray(0, 2), contents.subarray(2, 5), contents.subarray(5)];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull(controller) {
              const chunk = chunks.shift();
              if (chunk) controller.enqueue(chunk);
              else controller.close();
            },
          }),
          { headers: { 'content-type': 'application/octet-stream' } },
        ),
      ),
    );
    const pdf = await fetchWebPage('https://example.com/download');
    expect(pdf.readable).toBe(false);
    expect(pdf.truncated).toBe(false);
    expect((await readFile(pdf.document!.input)).equals(contents)).toBe(true);
    await releaseDocumentResource(pdf.document!.jobId);
  });

  it('PDF 重定向只下载一次，任务记录最终来源地址', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: '/download' } }),
      )
      .mockResolvedValueOnce(
        new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const pdf = await fetchWebPage('https://example.com/start');
    expect(pdf.source.url).toBe('https://example.com/download');
    expect(fetch).toHaveBeenCalledTimes(2);
    await releaseDocumentResource(pdf.document!.jobId);
  });

  it('下载中断时清理未完成任务', async () => {
    let pulls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull(controller) {
              if (pulls++ === 0) controller.enqueue(Buffer.from('%PDF-1.7'));
              else controller.error(new Error('download interrupted'));
            },
          }),
          { headers: { 'content-type': 'application/pdf' } },
        ),
      ),
    );
    await expect(fetchWebPage('https://example.com/file')).rejects.toThrow('download interrupted');
    expect(await readdir(join(profile.root, 'dela-document-reading'))).toEqual([]);
  });

  it('PDF 超过下载上限时明确失败，不留下截断文件', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('%PDF-', {
          headers: {
            'content-type': 'application/pdf',
            'content-length': String(128 * 1024 * 1024 + 1),
          },
        }),
      ),
    );
    await expect(fetchWebPage('https://example.com/large')).rejects.toThrow('128 MiB');
    expect(await readdir(join(profile.root, 'dela-document-reading'))).toEqual([]);
  });

  it('依赖缺失时提示安装并取消 PDF 响应，不创建任务', async () => {
    const cancel = vi.fn();
    vi.mocked(assertDocumentDependency).mockImplementationOnce(() => {
      throw new Error('请先在设置 › Skills 安装文档读取组件');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from('%PDF-1.7'));
            },
            cancel,
          }),
          { headers: { 'content-type': 'application/pdf' } },
        ),
      ),
    );
    await expect(fetchWebPage('https://example.com/file')).rejects.toThrow('安装文档读取组件');
    expect(cancel).toHaveBeenCalled();
    expect(await readdir(join(profile.root, 'dela-document-reading'))).toEqual([]);
  });

  it('纯前端渲染的页面提取过少时兜底抓取正文与链接并说明原因', async () => {
    const html = `<html><head><title>App</title></head><body>
      <div id="root"></div>
      <script>${'window.__DATA__ = 1;'.repeat(200)}</script>
      <a href="https://example.com/docs/intro">入门文档</a>
      <a href="https://example.com/docs/api">API 参考</a>
    </body></html>`;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
        ),
    );
    const page = await fetchWebPage('https://example.com/app');
    expect(page.text).toContain('入门文档');
    expect(page.text).toContain('[API 参考](https://example.com/docs/api)');
    expect(page.text).not.toContain('window.__DATA__');
    expect(page.note).toContain('JavaScript 动态渲染');
  });

  it('普通网页仍按 2 MiB 截断并说明内容不完整', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('x'.repeat(2 * 1024 * 1024 + 1), {
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );
    expect(await fetchWebPage('https://example.com/text')).toMatchObject({
      truncated: true,
      totalCharacters: 2 * 1024 * 1024,
      note: expect.stringContaining('内容可能不完整'),
    });
  });

  it('注册 DeepSeek 且开启网页读取时优先走官方抓取', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: 'DeepSeek 标题', content: '正文'.repeat(11000) }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const page = await fetchWebPage('https://example.com/page', 0, { apiKey: 'sk-test' });
    expect(page).toMatchObject({ title: 'DeepSeek 标题', contentType: 'text/markdown' });
    expect(page.nextOffset).toBe(20000);
    expect(page.text).toHaveLength(20000);
    expect(page.source.url).toBe('https://example.com/page');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('https://api.deepseek.com/v1/tools/fetch');
  });

  it('DeepSeek 取不到正文时回退本地抓取', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"not found"}}', { status: 404 }))
      .mockResolvedValueOnce(
        new Response('<p>本地正文</p>', { headers: { 'content-type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const page = await fetchWebPage('https://example.com/page', 0, { apiKey: 'sk-test' });
    expect(page.text).toContain('本地正文');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('续读复用快照与抓取时间，支持小页、刷新与过期', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response('abcdefghij', { headers: { 'content-type': 'text/plain' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const first = await fetchWebPage('https://example.com/snapshot', 0, undefined, { maxChars: 4 });
    vi.setSystemTime(Date.now() + 1000);
    const second = await fetchWebPage(
      'https://example.com/snapshot#section',
      first.nextOffset!,
      undefined,
      { maxChars: 4 },
    );
    expect(first.text + second.text).toBe('abcdefgh');
    expect(first.cache?.status).toBe('miss');
    expect(second.cache?.status).toBe('hit');
    expect(second.source.fetchedAt).toBe(first.source.fetchedAt);
    expect(fetch).toHaveBeenCalledTimes(1);
    const refreshed = await fetchWebPage('https://example.com/snapshot', 0, undefined, {
      refresh: true,
    });
    expect(refreshed.cache?.status).toBe('bypass');
    expect(refreshed.source.fetchedAt).not.toBe(first.source.fetchedAt);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    expect((await fetchWebPage('https://example.com/snapshot')).cache?.status).toBe('miss');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])('旧请求晚完成不覆盖刷新快照，旧请求 refresh=%s', async (refresh) => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveNew = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetch);
    const old = fetchWebPage('https://example.com/refresh-race', 0, undefined, { refresh });
    const newer = fetchWebPage('https://example.com/refresh-race', 0, undefined, { refresh: true });
    resolveNew(new Response('new snapshot', { headers: { 'content-type': 'text/plain' } }));
    await newer;
    resolveOld(new Response('old snapshot', { headers: { 'content-type': 'text/plain' } }));
    expect((await old).text).toBe('old snapshot');
    const cached = await fetchWebPage('https://example.com/refresh-race');
    expect(cached.text).toBe('new snapshot');
    expect(cached.cache?.status).toBe('hit');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('并发请求合并正文但各自分页，凭据与本地模式不共用快照', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ title: '文章', content: 'abcdefghij' })),
      );
    vi.stubGlobal('fetch', fetch);
    const [first, second] = await Promise.all([
      fetchWebPage('https://example.com/shared', 0, { apiKey: 'fake-a' }, { maxChars: 4 }),
      fetchWebPage('https://example.com/shared', 4, { apiKey: 'fake-a' }, { maxChars: 4 }),
    ]);
    expect(first.text + second.text).toBe('abcdefgh');
    expect(second.cache?.status).toBe('shared');
    expect(fetch).toHaveBeenCalledTimes(1);
    await fetchWebPage('https://example.com/shared', 0, { apiKey: 'fake-b' });
    await fetchWebPage('https://example.com/shared');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(first)).not.toContain('fake-a');
  });

  it.each([
    ['https://example.com/private', '<p>private body</p>', { 'cache-control': 'private' }],
    ['https://example.com/cookie', '<p>cookie body</p>', { 'set-cookie': 'session=fake' }],
    ['https://example.com/login', '<p>Sign in</p>', {}],
    ['https://example.com/challenge', '<title>Just a moment</title><p>Checking</p>', {}],
    ['https://example.com/form', '<input type="password"><p>Account</p>', {}],
    ['https://example.com/article?token=fake', '<p>article</p>', {}],
  ])('敏感或阻拦页不缓存：%s', async (url, html, headers) => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(html, { headers: { 'content-type': 'text/html', ...headers } }),
      );
    vi.stubGlobal('fetch', fetch);
    expect((await fetchWebPage(url)).cache?.status).toBe('bypass');
    await fetchWebPage(url);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('失败不缓存，缓存按条目与总字符数受限', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(
        async () => new Response('x'.repeat(300000), { headers: { 'content-type': 'text/plain' } }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(fetchWebPage('https://example.com/bounded/0')).rejects.toThrow('offline');
    for (let i = 0; i < 15; i++) await fetchWebPage(`https://example.com/bounded/${i}`);
    expect((await fetchWebPage('https://example.com/bounded/0')).cache?.status).toBe('miss');
    expect(fetch).toHaveBeenCalledTimes(17);
    fetch.mockImplementation(
      async () => new Response('small', { headers: { 'content-type': 'text/plain' } }),
    );
    for (let i = 0; i < 17; i++)
      await fetchWebPage(`https://example.com/small/${i}`, 0, undefined, { refresh: true });
    expect((await fetchWebPage('https://example.com/small/0')).cache?.status).toBe('miss');
  });

  it('PDF 并发调用创建独立任务，释放后再次调用不会复用旧任务', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const [first, second] = await Promise.all([
      fetchWebPage('https://example.com/independent.pdf'),
      fetchWebPage('https://example.com/independent.pdf'),
    ]);
    expect(first.document!.jobId).not.toBe(second.document!.jobId);
    await releaseDocumentResource(first.document!.jobId);
    await releaseDocumentResource(second.document!.jobId);
    const third = await fetchWebPage('https://example.com/independent.pdf');
    expect(third.document!.jobId).not.toBe(first.document!.jobId);
    await releaseDocumentResource(third.document!.jobId);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('分页参数在请求前验证', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(fetchWebPage('https://example.com', -1)).rejects.toThrow('offset');
    await expect(
      fetchWebPage('https://example.com', 0, undefined, { maxChars: 0 }),
    ).rejects.toThrow('maxChars');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('PDF 直链不经过 DeepSeek，仍走文档流程', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const pdf = await fetchWebPage('https://example.com/file.pdf', 0, { apiKey: 'sk-test' });
    expect(pdf).toMatchObject({ readable: false, text: '' });
    expect(fetch.mock.calls[0]![0].toString()).toBe('https://example.com/file.pdf');
    await releaseDocumentResource(pdf.document!.jobId);
  });
});
