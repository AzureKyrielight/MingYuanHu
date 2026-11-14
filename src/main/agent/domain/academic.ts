import { app } from 'electron';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  COURSE_PAPER_FORMATS,
  coursePaperFormat,
  type CoverFieldKey,
} from '../../documents/academic/format';
import {
  academicCoverSchema,
  academicProfileSchema,
  checkCoursePaperDraft,
  coursePaperDraftSchema,
} from '../../documents/academic/draft';
import { renderCoursePaper } from '../../documents/academic/render';
import {
  academicProfilePath,
  readAcademicProfile,
  writeAcademicProfile,
} from '../../documents/academic/profile';
import { tool, toolError } from './shared';

// 文书写作用文件承载草稿：正文由 write 工具落到项目里，渲染只回传路径、字数和检查结果，
// 避免长文反复穿过工具参数。封面字段优先取用户本机缓存的个人信息，其次取本次传入的值。

const DRAFT_SIZE_LIMIT = 2_000_000;

const COVER_FIELDS: CoverFieldKey[] = [
  'title',
  'course',
  'teacher',
  'college',
  'major',
  'studentName',
  'studentId',
  'grade',
];

function homeProfilePath(): string {
  return academicProfilePath(app.getPath('home'));
}

function absolutePath(value: string, label: string): string {
  if (!isAbsolute(value))
    throw toolError(
      'INVALID_INPUT',
      `${label} 需要绝对路径（例如 C:/Users/me/project/draft.json），当前为 ${value}`,
    );
  return resolve(value);
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '草稿'}：${issue.message}`)
    .join('；');
}

function readDraft(path: string) {
  if (!existsSync(path)) throw toolError('NOT_FOUND', `草稿文件不存在：${path}`);
  if (statSync(path).size > DRAFT_SIZE_LIMIT)
    throw toolError('INVALID_INPUT', `草稿文件超过 ${DRAFT_SIZE_LIMIT / 1_000_000} MB`);
  try {
    return coursePaperDraftSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error instanceof z.ZodError)
      throw toolError('INVALID_INPUT', `草稿格式不正确：${describeIssues(error)}`);
    throw toolError('INVALID_INPUT', `草稿不是合法 JSON：${(error as Error).message}`);
  }
}

function loadProfile(warnings: string[]) {
  try {
    return readAcademicProfile(homeProfilePath());
  } catch {
    warnings.push('本机个人信息文件无法解析，封面按本次传入的字段生成');
    return {};
  }
}

export const academicFormatsTool = tool(
  '列出可用的学校文书格式：封面字段、篇幅与关键词要求。生成课程论文前先确认格式 id。',
  z.object({}).strict(),
  () => ({
    formats: Object.values(COURSE_PAPER_FORMATS).map((format) => ({
      id: format.id,
      name: format.name,
      description: format.description,
      coverFields: COVER_FIELDS,
      limits: format.limits,
      notes: format.notes,
    })),
  }),
);

export const academicRenderTool = tool(
  '把结构化论文草稿渲染成符合学校格式的 DOCX。draft 是项目里的草稿 JSON 绝对路径，输出默认与草稿同名；封面学生信息从本机缓存读取。validateOnly 只做检查不写文件。',
  z
    .object({
      format: z.string().trim().min(1).max(60).default('scu-course-paper'),
      draft: z.string().trim().min(1).max(4096),
      output: z.string().trim().min(1).max(4096).optional(),
      cover: academicCoverSchema.optional(),
      overwrite: z.boolean().default(false),
      validateOnly: z.boolean().default(false),
    })
    .strict(),
  async (input) => {
    const format = coursePaperFormat(input.format);
    const draftPath = absolutePath(input.draft, 'draft');
    const draft = readDraft(draftPath);
    const check = checkCoursePaperDraft(draft, format);
    const warnings = [...check.warnings];
    const profile = loadProfile(warnings);
    const merged = { title: draft.title, ...profile, ...input.cover };
    const cover = Object.fromEntries(
      COVER_FIELDS.map((field) => [field, merged[field] ?? '']),
    ) as Record<CoverFieldKey, string>;
    const missing = COVER_FIELDS.filter((field) => !cover[field]);
    if (missing.length)
      warnings.push(
        `封面缺项：${missing.map((field) => format.cover.labels[field].replace(/\u3000/g, '')).join('、')}；可用 academic_profile 保存一次`,
      );

    if (input.validateOnly) return { valid: true, format: format.id, stats: check.stats, warnings };

    const outputPath = input.output
      ? isAbsolute(input.output)
        ? resolve(input.output)
        : resolve(dirname(draftPath), input.output)
      : join(dirname(draftPath), `${basename(draftPath, extname(draftPath))}.docx`);
    if (extname(outputPath).toLowerCase() !== '.docx')
      throw toolError('INVALID_INPUT', '输出文件必须是 .docx');
    if (!existsSync(dirname(outputPath)))
      throw toolError('NOT_FOUND', `输出目录不存在：${dirname(outputPath)}`);
    if (existsSync(outputPath) && !input.overwrite)
      throw toolError(
        'VERSION_CONFLICT',
        `输出文件已存在：${outputPath}；确认覆盖请传 overwrite: true`,
      );

    const buffer = await renderCoursePaper(format, draft, cover);
    writeFileSync(outputPath, buffer);
    return {
      path: outputPath,
      bytes: buffer.byteLength,
      format: format.id,
      stats: check.stats,
      warnings,
    };
  },
);

export const academicProfileTool = tool(
  '读取或保存本机缓存的封面个人信息（姓名、学号、学院、专业、年级、课程、教师）。保存后生成文书时自动填写，不必每次提供。',
  z.object({ save: academicProfileSchema.optional() }).strict(),
  (input) => {
    const path = homeProfilePath();
    if (!input.save) return { path, profile: readAcademicProfile(path) };
    try {
      return { path, profile: writeAcademicProfile(path, input.save) };
    } catch {
      throw toolError('INVALID_INPUT', `个人信息文件无法解析，请先修正或删除：${path}`);
    }
  },
);

export const academicTools = {
  academic_formats: academicFormatsTool,
  academic_render: academicRenderTool,
  academic_profile: academicProfileTool,
};
