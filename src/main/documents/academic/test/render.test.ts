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

/** 读 zip 中央目录里的单个文件：docx 由 jszip 生成，deflate 压缩。 */
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
  it('writes the school format: fonts, size, fixed line spacing and numbering', async () => {
    const buffer = await renderCoursePaper(format, draft, {
      title: draft.title,
      course: '形势与政策',
      teacher: '李四',
      college: '计算机学院',
      major: '计算机科学与技术',
      studentName: '张三',
      studentId: '2021141460001',
      grade: '2021',
    });
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    const xml = readZipEntry(buffer, 'word/document.xml').toString('utf8');
    expect(xml).toContain('本科生课程论文');
    expect(xml).toContain('学生姓名：张三');
    expect(xml).toContain('w:eastAsia="宋体"');
    expect(xml).toContain('w:eastAsia="黑体"');
    expect(xml).toContain('w:eastAsia="楷体"');
    // 正文小四（24 半磅）、20 磅固定行距（400 twips）、首行缩进 2 字符。
    expect(xml).toContain('w:sz w:val="24"');
    expect(xml).toContain('w:line="400" w:lineRule="exact"');
    expect(xml).toContain('w:firstLineChars="200"');
    // 二级标题自动编号，三级小节带 1.1 前缀。
    expect(xml).toContain('一、研究背景');
    expect(xml).toContain('二、推进路径');
    expect(xml).toContain('1.1　政策脉络');
    // 参考文献按顺序加编号。
    expect(xml).toContain('[1] 参考文献甲');
    expect(xml).toContain('[3] 参考文献丙');
    // 纸张与页边距跟随格式定义。
    expect(xml).toContain('w:w="11906" w:h="16838"');
    expect(xml).toContain('w:left="1800"');
  });
});
