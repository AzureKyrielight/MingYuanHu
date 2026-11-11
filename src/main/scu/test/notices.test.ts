import { describe, expect, it } from 'vitest';
import { decodeHtml, parseNoticeDetail, parseNoticeList } from '../notices';

describe('decodeHtml', () => {
  it('decodes UTF-8 pages (jwc.scu.edu.cn 现状)', () => {
    const bytes = new TextEncoder().encode('<meta charset="utf-8"><p>关于选派本科生</p>');
    expect(decodeHtml(bytes, 'text/html')).toContain('关于选派本科生');
  });

  it('honours a GBK meta declaration', () => {
    // 「中文」的 GBK 字节；用 latin1 反解出原始字节后按 gb18030 解码。
    const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]);
    const html = new Uint8Array([
      ...new TextEncoder().encode('<meta charset="gbk"><p>'),
      ...gbk,
      ...new TextEncoder().encode('</p>'),
    ]);
    expect(decodeHtml(html, 'text/html')).toContain('中文');
  });

  it('uses the Content-Type charset when present', () => {
    const bytes = new TextEncoder().encode('<p>about</p>');
    expect(decodeHtml(bytes, 'text/html; charset=UTF-8')).toContain('about');
  });

  it('falls back to UTF-8 for unknown labels', () => {
    const bytes = new TextEncoder().encode('<p>回退</p>');
    expect(decodeHtml(bytes, 'text/html; charset=x-unknown')).toContain('回退');
  });
});

const LIST_HTML = `
<div class="tz-list"><ul>
  <li>
    <a href="info/1069/10920.htm" target="_blank">
      <div class="date"><p>11/04 </p><span>2026</span></div>
      <div class="text"><p>关于选派本科生参加“大川视界”2027年寒假德国海德堡大学...</p></div>
      <div class="more">查看详情 &gt;</div>
    </a>
  </li>
  <li>
    <a href="info/1069/10913.htm" target="_blank">
      <div class="date"><p>10/28 </p><span>2026</span></div>
      <div class="text"><p>关于开展2026-2027学年秋季学期期中教学检查的通知</p></div>
      <div class="more">查看详情 &gt;</div>
    </a>
  </li>
  <li>
    <a href="info/1069/10920.htm" target="_blank">
      <div class="date"><p>11/04 </p><span>2026</span></div>
      <div class="text"><p>重复条目</p></div>
    </a>
  </li>
</ul></div>`;

describe('parseNoticeList', () => {
  it('解析标题、日期与链接，并按链接去重', () => {
    const notices = parseNoticeList(LIST_HTML);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toEqual({
      id: 'info/1069/10920.htm',
      title: '关于选派本科生参加“大川视界”2027年寒假德国海德堡大学...',
      date: '2026-11-04',
      url: 'https://jwc.scu.edu.cn/info/1069/10920.htm',
    });
    expect(notices[1]?.date).toBe('2026-10-28');
  });

  it('结构不匹配时返回空数组', () => {
    expect(parseNoticeList('<html></html>')).toEqual([]);
  });
});

describe('parseNoticeDetail', () => {
  const DETAIL_HTML = `
  <div class="content">
    <h1><span>关于选派本科生参加“大川视界”项目的通知</span></h1>
    <p><span>添加时间：2026-11-04 </span><span>点击数：1</span></p>
    <div id="vsb_content" class="detail-text">
      <div class="v_news_content">
        <p>各学院：</p>
        <div class="inner"><p>现将有关事项通知如下。</p></div>
        <p>教务处<br />2026年11月4日</p>
      </div>
    </div>
  </div>`;

  it('提取标题、发布时间与正文（含嵌套 div）', () => {
    const detail = parseNoticeDetail(DETAIL_HTML, 'info/1069/10920.htm');
    expect(detail.title).toBe('关于选派本科生参加“大川视界”项目的通知');
    expect(detail.date).toBe('2026-11-04');
    expect(detail.content).toContain('各学院：');
    expect(detail.content).toContain('现将有关事项通知如下。');
    expect(detail.content).toContain('2026年11月4日');
    expect(detail.content).not.toContain('<p>');
  });

  it('缺少正文容器时内容为空', () => {
    expect(parseNoticeDetail('<html></html>', 'info/1/2.htm').content).toBe('');
  });
});
