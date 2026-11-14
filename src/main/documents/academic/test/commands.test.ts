import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const home = mkdtempSync(join(tmpdir(), 'dela-academic-'));
vi.mock('electron', () => ({ app: { getPath: () => home } }));

const { academicTools } = await import('../../../agent/domain/academic');

const project = mkdtempSync(join(tmpdir(), 'dela-academic-project-'));

const draft = {
  title: '中国式现代化视域下乡村全面振兴的实践路径',
  abstract: '以政策文本与统计数据为依据，对乡村全面振兴的推进方式进行了梳理。'.repeat(8),
  keywords: ['中国式现代化', '乡村振兴', '城乡融合'],
  sections: [
    {
      title: '研究背景',
      paragraphs: ['全面建设社会主义现代化国家，最艰巨最繁重的任务仍然在农村[1]。'],
      children: [{ title: '政策脉络', paragraphs: ['中央一号文件连续部署三农工作[2]。'] }],
    },
  ],
  references: ['参考文献甲', '参考文献乙', '参考文献丙'],
};

function writeDraft(name: string, value: unknown = draft): string {
  const path = join(project, name);
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('academic_render', () => {
  it('renders a docx next to the draft and reports stats', async () => {
    const draftPath = writeDraft('论文.json');
    const result = (await academicTools.academic_render.execute({ draft: draftPath })) as {
      path: string;
      bytes: number;
      stats: { referenceCount: number };
      warnings: string[];
    };
    expect(result.path).toBe(join(project, '论文.docx'));
    expect(result.bytes).toBeGreaterThan(5000);
    expect(result.stats.referenceCount).toBe(3);
    expect(readFileSync(result.path).subarray(0, 2).toString()).toBe('PK');
    expect(result.warnings.join('\n')).toContain('封面缺项');
  });

  it('validateOnly checks the draft without writing a file', async () => {
    const draftPath = writeDraft('自查.json', { ...draft, keywords: ['只有一个'] });
    const before = readdirSync(project).length;
    const result = (await academicTools.academic_render.execute({
      draft: draftPath,
      validateOnly: true,
    })) as { valid: boolean; warnings: string[] };
    expect(result.valid).toBe(true);
    expect(result.warnings.join('\n')).toContain('关键词 1 个');
    expect(readdirSync(project).length).toBe(before);
  });

  it('rejects relative paths and unknown formats', async () => {
    await expect(academicTools.academic_render.execute({ draft: 'draft.json' })).rejects.toThrow(
      '绝对路径',
    );
    await expect(
      academicTools.academic_render.execute({ draft: writeDraft('x.json'), format: 'unknown' }),
    ).rejects.toThrow('未知的文书格式');
  });

  it('refuses to overwrite an existing file unless asked', async () => {
    const draftPath = writeDraft('覆盖.json');
    await academicTools.academic_render.execute({ draft: draftPath });
    await expect(academicTools.academic_render.execute({ draft: draftPath })).rejects.toThrow(
      '输出文件已存在',
    );
    await expect(
      academicTools.academic_render.execute({ draft: draftPath, overwrite: true }),
    ).resolves.toMatchObject({ path: join(project, '覆盖.docx') });
  });

  it('reports schema violations instead of writing a broken document', async () => {
    const draftPath = writeDraft('缺字段.json', { title: '只有标题' });
    await expect(academicTools.academic_render.execute({ draft: draftPath })).rejects.toThrow(
      '草稿格式不正确',
    );
  });
});

describe('academic_profile', () => {
  it('saves cover fields locally and fills them on the next render', async () => {
    await academicTools.academic_profile.execute({
      save: { studentName: '张三', college: '计算机学院' },
    });
    const draftPath = writeDraft('带封面.json');
    const result = (await academicTools.academic_render.execute({ draft: draftPath })) as {
      warnings: string[];
    };
    expect(result.warnings.join('\n')).not.toContain('学生姓名');
    expect(JSON.parse(readFileSync(join(home, '.dela', 'academic-profile.json'), 'utf8'))).toEqual({
      studentName: '张三',
      college: '计算机学院',
    });
  });
});

describe('academic_formats', () => {
  it('exposes the schema the model needs, and it stays JSON-serializable', async () => {
    const result = (await academicTools.academic_formats.execute({})) as {
      formats: { id: string; limits: unknown }[];
    };
    expect(result.formats[0]?.id).toBe('scu-course-paper');
    expect(() =>
      z.toJSONSchema(academicTools.academic_render.schema, { io: 'input' }),
    ).not.toThrow();
  });
});
