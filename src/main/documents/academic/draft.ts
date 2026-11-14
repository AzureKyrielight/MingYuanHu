import { z } from 'zod';
import type { CoursePaperFormat } from './format';

// 论文草稿是模型唯一需要产出的结构；排版、编号、封面字段填充都在渲染层完成。
// 章节只允许两级：二级标题由渲染器补“一、二、”，三级补“1.1”。

const paragraphText = z.string().trim().min(1).max(20_000);

const levelThreeSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    paragraphs: z.array(paragraphText).default([]),
  })
  .strict();

const sectionSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    paragraphs: z.array(paragraphText).default([]),
    children: z.array(levelThreeSchema).max(30).default([]),
  })
  .strict();

export const coursePaperDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    abstract: z.string().trim().min(1).max(3000),
    keywords: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
    sections: z.array(sectionSchema).min(1).max(20),
    references: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  })
  .strict();

export type CoursePaperDraft = z.infer<typeof coursePaperDraftSchema>;

export const academicCoverSchema = z
  .object({
    course: z.string().trim().min(1).max(60).optional(),
    teacher: z.string().trim().min(1).max(60).optional(),
    college: z.string().trim().min(1).max(60).optional(),
    major: z.string().trim().min(1).max(60).optional(),
    studentName: z.string().trim().min(1).max(60).optional(),
    studentId: z.string().trim().min(1).max(40).optional(),
    grade: z.string().trim().min(1).max(20).optional(),
  })
  .strict();

export const academicProfileSchema = academicCoverSchema;

export type AcademicProfile = z.infer<typeof academicProfileSchema>;

export type DraftCheck = {
  stats: {
    abstractChars: number;
    bodyChars: number;
    keywordCount: number;
    sectionCount: number;
    referenceCount: number;
    citationCount: number;
  };
  warnings: string[];
};

const PLACEHOLDER = /x{3,}|X{3,}|待填写|TODO/i;

function charCount(text: string): number {
  return [...text.replace(/\s/g, '')].length;
}

export function checkCoursePaperDraft(
  draft: CoursePaperDraft,
  format: CoursePaperFormat,
): DraftCheck {
  const warnings: string[] = [];
  const { limits } = format;
  const abstractChars = charCount(draft.abstract);
  const bodyChars = draft.sections.reduce(
    (total, section) =>
      total +
      charCount(section.title) +
      section.paragraphs.reduce((sum, text) => sum + charCount(text), 0) +
      section.children.reduce(
        (sum, child) =>
          sum +
          charCount(child.title) +
          child.paragraphs.reduce((childSum, text) => childSum + charCount(text), 0),
        0,
      ),
    0,
  );

  if (abstractChars < limits.abstractMinChars || abstractChars > limits.abstractMaxChars)
    warnings.push(
      `摘要 ${abstractChars} 字，格式要求约 400 字（${limits.abstractMinChars}–${limits.abstractMaxChars} 字）`,
    );
  if (draft.keywords.length < limits.keywordMin || draft.keywords.length > limits.keywordMax)
    warnings.push(
      `关键词 ${draft.keywords.length} 个，格式要求 ${limits.keywordMin}–${limits.keywordMax} 个`,
    );
  if (draft.references.length < limits.referenceMin)
    warnings.push(`参考文献 ${draft.references.length} 条，至少 ${limits.referenceMin} 条`);
  if (bodyChars < limits.bodyMinChars)
    warnings.push(`全文约 ${bodyChars} 字，篇幅偏短（建议 ${limits.bodyMinChars} 字以上）`);

  for (const section of draft.sections) {
    if (!section.paragraphs.length && !section.children.length)
      warnings.push(`章节「${section.title}」没有正文`);
    for (const child of section.children)
      if (!child.paragraphs.length) warnings.push(`小节「${child.title}」没有正文`);
  }

  const fullText = [
    draft.title,
    draft.abstract,
    ...draft.keywords,
    ...draft.sections.flatMap((section) => [
      section.title,
      ...section.paragraphs,
      ...section.children.flatMap((child) => [child.title, ...child.paragraphs]),
    ]),
    ...draft.references,
  ].join('\n');
  if (PLACEHOLDER.test(fullText)) warnings.push('草稿中仍有 XXX、待填写一类占位内容');

  const citations = new Set(
    [...fullText.matchAll(/\[(\d{1,3})\]/g)].map((match) => Number(match[1])),
  );
  const outOfRange = [...citations].filter((index) => index < 1 || index > draft.references.length);
  if (outOfRange.length)
    warnings.push(
      `正文引用了 [${outOfRange.join('、')}]，但参考文献只有 ${draft.references.length} 条`,
    );
  if (draft.references.length && !citations.size)
    warnings.push('正文没有任何 [n] 引用标记，参考文献与正文可能对不上');

  return {
    stats: {
      abstractChars,
      bodyChars,
      keywordCount: draft.keywords.length,
      sectionCount: draft.sections.length,
      referenceCount: draft.references.length,
      citationCount: citations.size,
    },
    warnings,
  };
}
