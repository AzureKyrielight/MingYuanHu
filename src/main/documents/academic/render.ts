import { AlignmentType, Document, LineRuleType, PageBreak, Packer, Paragraph, TextRun } from 'docx';
import type { CoverFieldKey, CoursePaperFormat, PaperTextStyle } from './format';
import type { CoursePaperDraft } from './draft';

/** 封面字段按样张顺序排列；缺项留空，由检查结果提醒补填。 */
const COVER_ORDER: CoverFieldKey[] = [
  'title',
  'course',
  'teacher',
  'college',
  'major',
  'studentName',
  'studentId',
  'grade',
];

const CHINESE_NUMERALS = '一二三四五六七八九十';

function chineseNumeral(value: number): string {
  if (value <= 10) return CHINESE_NUMERALS[value - 1]!;
  if (value < 20) return `十${CHINESE_NUMERALS[value - 11]}`;
  return String(value);
}

function fontOf(style: PaperTextStyle) {
  return { ascii: style.latin, hAnsi: style.latin, eastAsia: style.font, cs: style.latin };
}

function spacingOf(style: PaperTextStyle) {
  const before = Math.round((style.before ?? 0) * 20);
  const after = Math.round((style.after ?? 0) * 20);
  return style.lineRule === 'exact'
    ? { before, after, line: Math.round(style.line * 20), lineRule: LineRuleType.EXACT }
    : { before, after, line: Math.round(style.line * 240), lineRule: LineRuleType.AUTO };
}

function run(text: string, style: PaperTextStyle, bold = style.bold): TextRun {
  return new TextRun({ text, bold, size: Math.round(style.size * 2), font: fontOf(style) });
}

function paragraph(style: PaperTextStyle, segments: { text: string; bold?: boolean }[]): Paragraph {
  return new Paragraph({
    alignment: style.align === 'center' ? AlignmentType.CENTER : undefined,
    spacing: spacingOf(style),
    indent: style.firstLineChars
      ? {
          // Word 按字符数缩进；同时写入磅值，照顾只认 firstLine 的办公软件。
          firstLineChars: Math.round(style.firstLineChars * 100),
          firstLine: Math.round(style.firstLineChars * style.size * 20),
        }
      : undefined,
    children: segments.map((segment) => run(segment.text, style, segment.bold ?? style.bold)),
  });
}

function coverParagraphs(
  format: CoursePaperFormat,
  cover: Record<CoverFieldKey, string>,
): Paragraph[] {
  const { cover: rules } = format;
  const heading = paragraph({ ...rules.headingStyle, before: rules.headingBefore }, [
    { text: rules.heading },
  ]);
  const fields = COVER_ORDER.map((key, index) =>
    paragraph({ ...rules.fieldStyle, before: index === 0 ? rules.titleGap : rules.fieldGap }, [
      { text: `${rules.labels[key]}：${cover[key]}` },
    ]),
  );
  return [heading, ...fields];
}

function bodyParagraphs(format: CoursePaperFormat, draft: CoursePaperDraft): Paragraph[] {
  const paragraphs: Paragraph[] = [
    paragraph(format.bodyTitle, [{ text: draft.title }]),
    paragraph(format.abstractLabel, [{ text: '摘要：' }, { text: draft.abstract, bold: false }]),
    paragraph(format.keywordLabel, [
      { text: '关键词：' },
      { text: draft.keywords.join('；'), bold: false },
    ]),
  ];

  draft.sections.forEach((section, sectionIndex) => {
    paragraphs.push(
      paragraph(format.heading2, [
        { text: `${chineseNumeral(sectionIndex + 1)}、${section.title}` },
      ]),
    );
    for (const text of section.paragraphs) paragraphs.push(paragraph(format.body, [{ text }]));
    section.children.forEach((child, childIndex) => {
      paragraphs.push(
        paragraph(format.heading3, [
          { text: `${sectionIndex + 1}.${childIndex + 1}　${child.title}` },
        ]),
      );
      for (const text of child.paragraphs) paragraphs.push(paragraph(format.body, [{ text }]));
    });
  });

  if (draft.references.length) {
    paragraphs.push(paragraph(format.referenceHeading, [{ text: '参考文献' }]));
    draft.references.forEach((reference, index) => {
      paragraphs.push(paragraph(format.reference, [{ text: `[${index + 1}] ${reference}` }]));
    });
  }

  // 封面与正文之间用分页符隔开，而不是依赖空行凑满一页。
  return [new Paragraph({ children: [new PageBreak()] }), ...paragraphs];
}

export function buildCoursePaperDocument(
  format: CoursePaperFormat,
  draft: CoursePaperDraft,
  cover: Record<CoverFieldKey, string>,
): Document {
  return new Document({
    creator: '明远湖光',
    title: draft.title,
    description: format.name,
    sections: [
      {
        properties: {
          page: {
            size: { width: format.page.width, height: format.page.height },
            margin: format.page.margins,
          },
        },
        children: [...coverParagraphs(format, cover), ...bodyParagraphs(format, draft)],
      },
    ],
  });
}

export function renderCoursePaper(
  format: CoursePaperFormat,
  draft: CoursePaperDraft,
  cover: Record<CoverFieldKey, string>,
): Promise<Buffer> {
  return Packer.toBuffer(buildCoursePaperDocument(format, draft, cover));
}
