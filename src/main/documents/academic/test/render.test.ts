import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { coursePaperFormat } from '../format';
import { checkCoursePaperDraft, coursePaperDraftSchema } from '../draft';
import { renderCoursePaper } from '../render';

const format = coursePaperFormat('scu-course-paper');

const draft = coursePaperDraftSchema.parse({
  title: '中国式现代化视域下乡村全面振兴的实践路径',
  abstract: '以政策文本与统计数据为依据，对乡村全面振兴的推进方式进行了梳理。',
  keywords: ['中国式现代化', '乡村振兴', '城乡融合'],
  sections: [
    {
      title: '研究背景',
      paragraphs: ['全面建设社会主义现代化国家，最艰巨最繁重的任务仍然在农村[1]。'],
      children: [
        { title: '政策脉络', paragraphs: ['中共中央连续多年以一号文件部署三农工作[2]。'] },
      ],
    },
    {
      title: '推进路径',
      paragraphs: ['以县域为切入点推动城乡融合，是当前政策的着力点[3]。'],
    },
  ],
  references: ['参考文献甲', '参考文献乙', '参考文献丙'],
});

const cover = {
  title: draft.title,
  course: '形势与政策',
  teacher: '李四',
  college: '计算机学院',
  major: '计算机科学与技术',
  studentName: '张三',
  studentId: '2021141460001',
  grade: '2021',
};

/** 读 zip 中央目录里的单个文件：模板与输出都由 jszip 生成。 */
function readZipEntry(buffer: Buffer, name: string): Buffer {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('不是 zip 文件');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('中央目录损坏');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryName = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (entryName === name) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(start, start + compressedSize);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`zip 中缺少 ${name}`);
}

describe('course paper draft', () => {
  it('rejects unknown fields so the model cannot invent structure', () => {
    expect(() =>
      coursePaperDraftSchema.parse({ ...draft, cover: { studentName: '张三' } }),
    ).toThrow();
  });

  it('reports missing citations and short references', () => {
    const check = checkCoursePaperDraft(
      coursePaperDraftSchema.parse({
        ...draft,
        references: ['只有一条'],
        sections: [{ title: '一节' }],
      }),
      format,
    );
    expect(check.warnings.join('\n')).toContain('参考文献 1 条');
    expect(check.warnings.join('\n')).toContain('没有正文');
    expect(check.stats.bodyChars).toBe(2);
  });

  it('flags placeholders left in the body', () => {
    const check = checkCoursePaperDraft(
      coursePaperDraftSchema.parse({
        ...draft,
        sections: [{ title: '背景', paragraphs: ['学生姓名：张三XXX'] }],
      }),
      format,
    );
    expect(check.warnings.join('\n')).toContain('占位内容');
  });

  it('accepts a draft that matches the format limits', () => {
    const check = checkCoursePaperDraft(draft, format);
    expect(check.stats.citationCount).toBe(3);
  });
});

describe('renderCoursePaper', () => {
  it('fills the school template instead of rebuilding the layout', async () => {
    const buffer = await renderCoursePaper(draft, cover);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    const xml = readZipEntry(buffer, 'word/document.xml').toString('utf8');
    // 样张封面：校徽校章图形、分散对齐的标题、下划线填空都还在。
    expect(xml).toContain('生课程论文');
    expect(xml).toContain('<w:jc w:val="distribute"/>');
    expect(xml).toContain('<w:u w:val="single"/>');
    // 封面字段写进下划线里，题目取草稿标题。
    expect(xml).toContain('学生姓名');
    expect(xml).toContain('张三');
    expect(xml).toContain('2021141460001');
    expect(xml).toContain('2021');
    expect(xml).toContain(draft.title);
    // 正文段落沿用样张原型：楷体摘要、黑体二级标题、小四宋体正文与固定行距。
    expect(xml).toContain('w:eastAsia="楷体"');
    expect(xml).toContain('w:eastAsia="黑体"');
    expect(xml).toContain('w:line="400" w:lineRule="exact"');
    expect(xml).toContain('一、研究背景');
    expect(xml).toContain('1.1　政策脉络');
    expect(xml).toContain('[1] 参考文献甲');
    expect(xml).toContain('[3] 参考文献丙');
    // 两个分节（封面与正文）与样张一致。
    expect(xml.match(/<w:sectPr/g)?.length).toBe(2);
    // 占位符不能留在成品里。
    expect(xml).not.toContain('«');
    expect(readZipEntry(buffer, 'word/media/image3.png').byteLength).toBe(96845);
  });

  it('replaces the template metadata title with the paper title', async () => {
    const buffer = await renderCoursePaper(draft, cover);
    const props = readZipEntry(buffer, 'docProps/core.xml').toString('utf8');
    expect(props).toContain(draft.title);
  });

  it('keeps the underline blank when cover fields are missing', async () => {
    const buffer = await renderCoursePaper(draft, { title: draft.title });
    const xml = readZipEntry(buffer, 'word/document.xml').toString('utf8');
    expect(xml).toContain('学生姓名');
    expect(xml).not.toContain('«NAME»');
  });
});
