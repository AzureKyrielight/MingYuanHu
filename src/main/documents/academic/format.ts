// 学校文书格式：封面与正文段落样式都来自样张模板，这里只保留可用格式清单与检查阈值。

export type CoverFieldKey =
  'title' | 'course' | 'teacher' | 'college' | 'major' | 'studentName' | 'studentId' | 'grade';

export const COVER_LABELS: Record<CoverFieldKey, string> = {
  title: '题目',
  course: '课程名称',
  teacher: '任课教师',
  college: '学院',
  major: '专业',
  studentName: '学生姓名',
  studentId: '学号',
  grade: '年级',
};

export type CoursePaperFormat = {
  id: string;
  name: string;
  description: string;
  notes: string[];
  limits: {
    titleMaxChars: number;
    abstractMinChars: number;
    abstractMaxChars: number;
    keywordMin: number;
    keywordMax: number;
    referenceMin: number;
    bodyMinChars: number;
  };
};

export const COURSE_PAPER_FORMATS: Record<string, CoursePaperFormat> = {
  'scu-course-paper': {
    id: 'scu-course-paper',
    name: '四川大学本科生课程论文',
    description:
      '按导入的学校课程论文样张生成 DOCX；当前默认模板适用于课程论文的一般结构，课程名称不限定论文主题。封面保留校徽校章与下划线填空，正文二级标题四号黑体、三级标题小四楷体、正文小四宋体 20 磅固定行距。',
    notes: [
      '封面与正文样式直接取自样张模板，字号、行距、缩进以模板为准；改样式要换模板而不是改代码。',
      '样张写明摘要首行「缩进四格」，其模板实际排为 2 字符。',
      '表格、插图与公式未纳入自动排版，需要时在 Word 中手工加入。',
    ],
    limits: {
      titleMaxChars: 23,
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
