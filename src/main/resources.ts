import { app, shell } from 'electron';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { resourceRefSchema, type ResourceRef } from '../shared/resources';
import { mailAttachment, readMailMessage, saveMailAttachment } from './mail/api';
import { entry, importWorkspaceFiles, workspaceFilePath } from './workspace/api';
import { TEXT_PREVIEW_MAX_BYTES, formatByName, imageMimeOf, isTextContent } from '../shared/files';
import { localFileFormat, textRevision } from './workspace/files';
import { diskName } from './storage';
import { workspaceEntryIdSchema } from '../shared/workspace';
import { DOCUMENT_SKILL, assertDocumentDependency, documentPython } from './documents/runtime';

interface ResourceContent {
  title: string;
  format: 'file' | 'text' | 'markdown' | 'html' | 'image';
  text?: string;
  bytes?: Uint8Array;
  mime?: string;
  revision?: string;
  url?: string;
}

/** Agent 的资源读取不生成预览地址、不查询 Office 导出，也不枚举解析格式。 */
export async function readResourceContent(
  ref: Extract<ResourceRef, { type: 'workspace' | 'attachment' }>,
): Promise<ResourceContent> {
  if (ref.type === 'attachment') {
    const { attachment } = mailAttachment(ref.messageId, ref.part);
    return { title: attachment.filename, format: 'file' };
  }
  const item = entry(ref.id);
  if (item.kind !== 'file') throw new Error('请选择要读取的文件');
  // 名字已能判定的 PDF/Office 直接交给文档 skill，不碰文件；其余才读内容判定。
  const named = formatByName(item.path ?? item.name);
  if (named && named !== 'markdown' && named !== 'image')
    return { title: item.name, format: 'file' };
  const path = await workspaceFilePath(ref.id);
  const format = localFileFormat(path);
  if (format !== 'text' && format !== 'markdown' && format !== 'image')
    return { title: item.name, format: 'file' };
  const stats = await stat(path);
  // Agent 按 offset 分页读文本，不受编辑上限约束；只挡住整篇进内存会出问题的体量。
  if (stats.size > TEXT_PREVIEW_MAX_BYTES) throw new Error('文件较大，请在外部应用中打开');
  const bytes = await readFile(path);
  if (format === 'image')
    return {
      title: item.name,
      format: 'image',
      bytes,
      mime: imageMimeOf(path),
      revision: `${stats.mtimeMs}-${stats.size}`,
    };
  if (!isTextContent(bytes)) return { title: item.name, format: 'file' };
  const content = bytes.toString('utf8');
  return { title: item.name, format, text: content, revision: textRevision(content) };
}

const documentJobs = () => join(app.getPath('temp'), 'dela-document-reading');
const jobIdSchema = z.string().regex(/^job-[A-Za-z0-9]{6}$/);

export async function prepareDocumentResource(ref: ResourceRef) {
  return prepareDocumentFile((input) => withResourceFile(ref, (path) => copyFile(path, input)));
}

export async function prepareDocumentFile(writeInput: (path: string) => Promise<void>) {
  assertDocumentDependency();
  const root = documentJobs();
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !jobIdSchema.safeParse(entry.name).success) continue;
    const path = join(root, entry.name);
    if (Date.now() - (await stat(path)).mtimeMs > 24 * 60 * 60 * 1000)
      await rm(path, { recursive: true, force: true });
  }
  const job = await mkdtemp(join(root, 'job-'));
  try {
    const input = join(job, 'input');
    await writeInput(input);
    return {
      jobId: basename(job),
      python: documentPython(),
      script: join(app.getPath('home'), '.dela', 'skills', DOCUMENT_SKILL, 'scripts', 'read.py'),
      input,
      output: join(job, 'output'),
    };
  } catch (error) {
    await rm(job, { recursive: true, force: true });
    throw error;
  }
}

export async function releaseDocumentResource(jobId: unknown): Promise<void> {
  await rm(join(documentJobs(), jobIdSchema.parse(jobId)), { recursive: true, force: true });
}

export async function withResourceFile<T>(
  source: ResourceRef,
  consume: (path: string) => Promise<T> | T,
): Promise<T> {
  source = resourceRefSchema.parse(source);
  if (source.type === 'workspace') return consume(await workspaceFilePath(source.id));
  if (source.type !== 'attachment') throw new Error('请选择项目文件或邮件附件');
  const mail = await readMailMessage(source.messageId);
  const attachment = mail.attachments.find((item) => item.part === source.part);
  if (!attachment) throw new Error('附件不存在，请先同步邮件');
  const temporaryDirectory = await mkdtemp(join(app.getPath('temp'), 'dela-attachment-'));
  try {
    const path = join(temporaryDirectory, diskName(attachment.filename));
    await saveMailAttachment(source.messageId, source.part, path);
    return await consume(path);
  } finally {
    // Only remove the temporary directory created by this call.
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function copyResourceToProject(input: unknown) {
  const { source, parentId } = z
    .object({ source: resourceRefSchema, parentId: workspaceEntryIdSchema })
    .strict()
    .parse(input);
  return withResourceFile(source, (path) => {
    const [entry] = importWorkspaceFiles(parentId, [path]);
    return { ref: { type: 'workspace' as const, id: entry!.id }, entry: entry! };
  });
}

/** 用系统默认应用打开资源的本地源文件（pptx 关联通常指向 PowerPoint）。 */
export async function openResourceFile(ref: ResourceRef): Promise<void> {
  const parsed = resourceRefSchema.parse(ref);
  if (parsed.type !== 'workspace') throw new Error('仅支持我的资料条目');
  const path = await workspaceFilePath(parsed.id);
  const error = await shell.openPath(path);
  if (error) throw new Error(`无法用系统默认程序打开：${error}`);
}
