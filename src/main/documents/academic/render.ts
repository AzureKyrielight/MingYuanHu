// 直接在学校样张的 DOCX 上填内容：封面（校徽、校章、下划线填空）与正文段落样式都原样保留，
// 只替换模板里的 «SENTINEL» 占位。这样格式与样张一致，不依赖任何 Office 组件。
import JSZip from 'jszip';
import { COURSE_PAPER_TEMPLATE } from './template-data';
import type { CoursePaperDraft } from './draft';

const DOCUMENT_PART = 'word/document.xml';
const PROPS_PART = 'docProps/core.xml';

/** 模板占位符：封面字段与七个正文段落原型。 */
const PLACEHOLDER = {
  title: '«TITLE»',
  titlePad: '«TITLEPAD»',
  course: '«COURSE»',
  teacher: '«TEACHER»',
  college: '«COLLEGE»',
  major: '«MAJOR»',
  studentName: '«NAME»',
  studentId: '«ID»',
  grade: '«GRADE»',
  bodyTitle: '«BODYTITLE»',
  abstract: '«ABSTRACT»',
  keywords: '«KEYWORDS»',
  blank: '«BLANK»',
  heading2: '«H2»',
  heading3: '«H3»',
  body: '«BODY»',
  referenceHeading: '«REFHEAD»',
  reference: '«REF»',
} as const;

const CHINESE_NUMERALS = '一二三四五六七八九十';

/** 封面题目行在下划线上一行约能排 23 个 14 磅汉字：按标题长度调整行首留白，避免换行破坏封面。 */
const COVER_TITLE_CHARS = 23;
const COVER_TITLE_PAD_MAX = 10;

function chineseNumeral(value: number): string {
  if (value <= 10) return CHINESE_NUMERALS[value - 1]!;
  if (value < 20) return `十${CHINESE_NUMERALS[value - 11]}`;
  return String(value);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 草稿里一段正文；换行会让 Word 把内容截成两行，统一压成空格。 */
function normalize(text: string): string {
  return text.replace(/[\r\n]+/g, ' ');
}

/** 取占位所在的整个 <w:p>：克隆它就能带上样张里的字体、字号、缩进与行距。 */
function paragraphOf(xml: string, placeholder: string): string {
  const at = xml.indexOf(placeholder);
  if (at < 0) throw new Error(`模板缺少占位 ${placeholder}`);
  const open = Math.max(xml.lastIndexOf('<w:p>', at), xml.lastIndexOf('<w:p ', at));
  const close = xml.indexOf('</w:p>', at);
  if (open < 0 || close < 0) throw new Error(`模板占位不在段落内：${placeholder}`);
  return xml.slice(open, close + '</w:p>'.length);
}

function fill(prototype: string, placeholder: string, text: string): string {
  return prototype.replace(placeholder, escapeXml(text));
}

function bodyParagraphs(
  draft: CoursePaperDraft,
  prototype: (key: keyof typeof PLACEHOLDER) => string,
): string {
  const paragraphs = [
    fill(prototype('bodyTitle'), PLACEHOLDER.bodyTitle, draft.title),
    fill(prototype('abstract'), PLACEHOLDER.abstract, normalize(draft.abstract)),
    fill(prototype('keywords'), PLACEHOLDER.keywords, draft.keywords.join('；')),
    fill(prototype('blank'), PLACEHOLDER.blank, ''),
  ];
  draft.sections.forEach((section, sectionIndex) => {
    // 样张要求二级标题“上空一行”：首个标题前的空行已由摘要后的空段提供。
    if (sectionIndex > 0) paragraphs.push(fill(prototype('blank'), PLACEHOLDER.blank, ''));
    paragraphs.push(
      fill(
        prototype('heading2'),
        PLACEHOLDER.heading2,
        `${chineseNumeral(sectionIndex + 1)}、${section.title}`,
      ),
    );
    for (const text of section.paragraphs)
      paragraphs.push(fill(prototype('body'), PLACEHOLDER.body, normalize(text)));
    section.children.forEach((child, childIndex) => {
      paragraphs.push(
        fill(
          prototype('heading3'),
          PLACEHOLDER.heading3,
          `${sectionIndex + 1}.${childIndex + 1}　${child.title}`,
        ),
      );
      for (const text of child.paragraphs)
        paragraphs.push(fill(prototype('body'), PLACEHOLDER.body, normalize(text)));
    });
  });
  if (draft.references.length) {
    paragraphs.push(fill(prototype('blank'), PLACEHOLDER.blank, ''));
    paragraphs.push(fill(prototype('referenceHeading'), PLACEHOLDER.referenceHeading, '参考文献'));
    draft.references.forEach((reference, index) => {
      paragraphs.push(
        fill(prototype('reference'), PLACEHOLDER.reference, `[${index + 1}] ${reference}`),
      );
    });
  }
  return paragraphs.join('');
}

export async function renderCoursePaper(
  draft: CoursePaperDraft,
  cover: Record<string, string>,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(Buffer.from(COURSE_PAPER_TEMPLATE, 'base64'));
  const documentPart = zip.file(DOCUMENT_PART);
  if (!documentPart) throw new Error('课程论文模板缺少 document.xml');
  const xml = await documentPart.async('string');

  const templates = Object.fromEntries(
    Object.entries(PLACEHOLDER).map(([key, placeholder]) => [key, paragraphOf(xml, placeholder)]),
  ) as Record<keyof typeof PLACEHOLDER, string>;

  // 正文原型先取出来，再用它们拼出全文；占位段落本身随原型区间一起被替换掉。
  const body = bodyParagraphs(draft, (key) => templates[key]);
  const start = xml.indexOf(templates.bodyTitle);
  const lastReference = xml.lastIndexOf(templates.reference);
  const end = xml.indexOf('</w:p>', lastReference) + '</w:p>'.length;

  const values: Record<string, string> = {
    title: draft.title,
    titlePad: ' '.repeat(
      Math.max(
        0,
        Math.min(COVER_TITLE_PAD_MAX, Math.round((COVER_TITLE_CHARS - draft.title.length) / 2)),
      ),
    ),
    course: cover.course ?? '',
    teacher: cover.teacher ?? '',
    college: cover.college ?? '',
    major: cover.major ?? '',
    studentName: cover.studentName ?? '',
    studentId: cover.studentId ?? '',
    grade: (cover.grade ?? '').replace(/级$/, ''),
  };
  let patched = xml.slice(0, start) + body + xml.slice(end);
  for (const key of Object.keys(values))
    patched = patched.replaceAll(
      PLACEHOLDER[key as keyof typeof PLACEHOLDER],
      escapeXml(values[key]!),
    );

  const props = zip.file(PROPS_PART);
  if (props) {
    const propsXml = (await props.async('string')).replace(
      /<dc:title>[^<]*<\/dc:title>/,
      `<dc:title>${escapeXml(draft.title)}</dc:title>`,
    );
    zip.file(PROPS_PART, propsXml);
  }
  zip.file(DOCUMENT_PART, patched);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
