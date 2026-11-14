// 学校文书格式的机器可读版本：数值取自教务处下发的《课程论文格式参考》样张（A4、页边距 3.17/2.54cm、
// 正文小四宋体 20 磅固定行距）。改格式只改这里，渲染与检查共用同一份定义。

export type PaperTextStyle = {
  /** 中文字体（w:eastAsia）。 */
  font: string;
  /** 西文字体（w:ascii / hAnsi / cs）。 */
  latin: string;
  /** 字号，磅。 */
  size: number;
  bold?: boolean;
  align?: 'left' | 'center';
  /** 首行缩进字符数，按 Word 的 firstLineChars 写入。 */
  firstLineChars?: number;
  lineRule: 'exact' | 'multiple';
  /** exact 时是磅值，multiple 时是行数倍数。 */
  line: number;
  before?: number;
  after?: number;
};

export type CoverFieldKey =
  'title' | 'course' | 'teacher' | 'college' | 'major' | 'studentName' | 'studentId' | 'grade';

export type CoursePaperFormat = {
  id: string;
  name: string;
  description: string;
  notes: string[];
  /** 纸张与页边距，单位 twip（1/20 磅）。 */
  page: {
    width: number;
    height: number;
    margins: Record<'top' | 'bottom' | 'left' | 'right', number>;
  };
  cover: {
    heading: string;
    headingStyle: PaperTextStyle;
    fieldStyle: PaperTextStyle;
    labels: Record<CoverFieldKey, string>;
    /** 封面标题上方留白、题目行上方留白与其余字段的间距，单位磅。 */
    headingBefore: number;
    titleGap: number;
    fieldGap: number;
  };
  bodyTitle: PaperTextStyle;
  abstractLabel: PaperTextStyle;
  keywordLabel: PaperTextStyle;
  heading2: PaperTextStyle;
  heading3: PaperTextStyle;
  body: PaperTextStyle;
  referenceHeading: PaperTextStyle;
  reference: PaperTextStyle;
  limits: {
    abstractMinChars: number;
    abstractMaxChars: number;
    keywordMin: number;
    keywordMax: number;
    referenceMin: number;
    bodyMinChars: number;
  };
};

const SONG = '宋体';
const HEI = '黑体';
const KAI = '楷体';
const LATIN = 'Times New Roman';

const bodyLine = 20;

export const COURSE_PAPER_FORMATS: Record<string, CoursePaperFormat> = {
  'scu-course-paper': {
    id: 'scu-course-paper',
    name: '四川大学本科生课程论文',
    description:
      '四川大学本科生课程论文格式：封面、摘要与关键词、正文（二级标题四号黑体、三级标题小四楷体）、参考文献。',
    notes: [
      '样张写明摘要首行“缩进四格”，但其自身排版为 2 字符；此处按样张实际排版（2 字符）实现。',
      '表格、插图与公式未纳入自动排版，需要时在 Word 中手工加入。',
    ],
    page: {
      width: 11906,
      height: 16838,
      margins: { top: 1440, bottom: 1440, left: 1800, right: 1800 },
    },
    cover: {
      heading: '本科生课程论文',
      headingStyle: {
        font: '华文中宋',
        latin: '华文中宋',
        size: 26,
        bold: true,
        align: 'center',
        lineRule: 'multiple',
        line: 1,
      },
      fieldStyle: {
        font: SONG,
        latin: SONG,
        size: 14,
        bold: true,
        lineRule: 'multiple',
        line: 3,
      },
      labels: {
        title: '题　　目',
        course: '课程名称',
        teacher: '任课教师',
        college: '学　　院',
        major: '专　　业',
        studentName: '学生姓名',
        studentId: '学　　号',
        grade: '年　　级',
      },
      headingBefore: 60,
      titleGap: 96,
      fieldGap: 0,
    },
    bodyTitle: {
      font: HEI,
      latin: LATIN,
      size: 15,
      align: 'center',
      lineRule: 'exact',
      line: bodyLine,
      before: 15,
      after: 15,
    },
    abstractLabel: {
      font: KAI,
      latin: LATIN,
      size: 10.5,
      bold: true,
      firstLineChars: 2,
      lineRule: 'exact',
      line: bodyLine,
    },
    keywordLabel: {
      font: KAI,
      latin: LATIN,
      size: 10.5,
      bold: true,
      firstLineChars: 2,
      lineRule: 'exact',
      line: bodyLine,
    },
    heading2: {
      font: HEI,
      latin: LATIN,
      size: 14,
      lineRule: 'exact',
      line: bodyLine,
      before: 14,
    },
    heading3: {
      font: KAI,
      latin: LATIN,
      size: 12,
      lineRule: 'exact',
      line: bodyLine,
    },
    body: {
      font: SONG,
      latin: LATIN,
      size: 12,
      firstLineChars: 2,
      lineRule: 'exact',
      line: bodyLine,
    },
    referenceHeading: {
      font: HEI,
      latin: LATIN,
      size: 14,
      lineRule: 'exact',
      line: bodyLine,
      before: 14,
    },
    reference: {
      font: SONG,
      latin: LATIN,
      size: 12,
      lineRule: 'exact',
      line: bodyLine,
    },
    limits: {
      abstractMinChars: 300,
      abstractMaxChars: 600,
      keywordMin: 3,
      keywordMax: 5,
      referenceMin: 3,
      bodyMinChars: 1500,
    },
  },
};

export function coursePaperFormat(id: string): CoursePaperFormat {
  const format = COURSE_PAPER_FORMATS[id];
  if (!format) throw new Error(`未知的文书格式：${id}，可用格式见 academic_formats`);
  return format;
}
