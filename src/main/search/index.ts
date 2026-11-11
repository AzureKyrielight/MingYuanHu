import { ipcMain } from 'electron';
import { z } from 'zod';
import { GLOBAL_SEARCH_PER_KIND_LIMIT, type GlobalSearchResult } from '../../shared/search';
import { getTodoState } from '../todo';
import { todoStatusLabels } from '../../shared/todo';
import { getDatabase } from '../database';
import { checkWorkspaceSender } from '../ipc';
import { matchesAllTokens, rankByScore, splitSearchTokens, titleScore } from './rank';

const querySchema = z.string().trim().max(200);
const perKindLimit = GLOBAL_SEARCH_PER_KIND_LIMIT;

function likePattern(query: string): string {
  return `%${query.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`;
}

/**
 * 多关键词 AND：每个词都要在任一字段里出现（与界面「空格分隔多个关键词」的说明一致）。
 * 无关键词时返回空条件，调用方保持原来的「最近记录」排序。
 */
function tokenFilter(
  fields: readonly string[],
  tokens: readonly string[],
): { sql: string; values: string[] } {
  const values: string[] = [];
  const clauses = tokens.map((token) => {
    const pattern = likePattern(token);
    values.push(...fields.map(() => pattern));
    return `(${fields.map((field) => `${field} LIKE ? ESCAPE '!'`).join(' OR ')})`;
  });
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', values };
}

type ProjectRow = { id: string; title: string; updatedAt: string };
type ChatRow = {
  id: string;
  projectId: string | null;
  title: string;
  subtitle: string;
  updatedAt: string;
};
type MailRow = {
  id: number;
  subject: string | null;
  senderName: string | null;
  senderAddress: string | null;
  snippet: string | null;
  date: string | null;
};
type CanvasFileRow = { id: string; title: string; courseName: string | null };
type LessonRow = {
  code: string;
  name: string;
  teacher: string | null;
  classroom: string | null;
};

/**
 * Searches only data already stored in Dela's SQLite database. In particular,
 * Canvas files are matched by their cached title and never downloaded here.
 *
 * 查询用空白分隔多个关键词时按 AND 处理（每个词都要在任一字段命中），
 * 同类结果再按标题命中的位置排序（完全相等 > 前缀 > 词首 > 任意位置）。
 */
export function queryGlobalSearch(query: string): GlobalSearchResult[] {
  const db = getDatabase();
  const tokens = splitSearchTokens(query);
  const score = (text: string | null | undefined) => titleScore(text ?? '', tokens);
  const projectFilter = tokenFilter(['name'], tokens);
  const projects = rankByScore(
    db
      .prepare(
        `SELECT id, name AS title, updated_at AS updatedAt FROM workspace_entries WHERE kind='project'${projectFilter.sql} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...projectFilter.values, perKindLimit) as ProjectRow[],
    (row) => score(row.title),
  );
  // 只按会话标题匹配：正文在 Pi 的 JSONL 会话文件里，sessions 表没有消息列。
  const chatFilter = tokenFilter(['sessions.title'], tokens);
  const chats = rankByScore(
    db
      .prepare(
        `SELECT sessions.id, sessions.project_id AS projectId, sessions.title, coalesce(project.name, '首页') AS subtitle, sessions.updated_at AS updatedAt FROM sessions LEFT JOIN workspace_entries AS project ON project.id=sessions.project_id AND project.kind='project' WHERE sessions.parent_id IS NULL${chatFilter.sql} ORDER BY sessions.updated_at DESC LIMIT ?`,
      )
      .all(...chatFilter.values, perKindLimit) as ChatRow[],
    (row) => score(row.title),
  );
  const mailFilter = tokenFilter(
    ['subject', 'sender_name', 'sender_address', 'snippet', 'body_text'],
    tokens,
  );
  const mail = rankByScore(
    db
      .prepare(
        `SELECT id, subject, sender_name AS senderName, sender_address AS senderAddress, snippet, date FROM mail_messages WHERE deleted_at IS NULL${mailFilter.sql} ORDER BY date DESC LIMIT ?`,
      )
      .all(...mailFilter.values, perKindLimit) as MailRow[],
    (row) => score(row.subject) || score(row.snippet) || score(row.senderName),
  );
  const fileFilter = tokenFilter(
    ["json_extract(canvas_sources.data, '$.title')", "json_extract(canvas_courses.data, '$.name')"],
    tokens,
  );
  const files = rankByScore(
    db
      .prepare(
        `SELECT canvas_sources.id, json_extract(canvas_sources.data, '$.title') AS title, json_extract(canvas_courses.data, '$.name') AS courseName FROM canvas_sources LEFT JOIN canvas_courses ON canvas_courses.id=canvas_sources.course_id WHERE json_extract(canvas_sources.data, '$.kind')='file'${fileFilter.sql} ORDER BY canvas_sources.id LIMIT ?`,
      )
      .all(...fileFilter.values, perKindLimit) as CanvasFileRow[],
    (row) => score(row.title),
  );
  // 课表只查最近一次同步的学期：不同学期的同名课程对搜索没有区分度，合并成一门即可。
  const lessonFilter = tokenFilter(
    ['course_name', 'course_code', 'teacher', 'classroom', 'class_name'],
    tokens,
  );
  const lessons = rankByScore(
    db
      .prepare(
        `SELECT course_code AS code, max(course_name) AS name, max(teacher) AS teacher, max(classroom) AS classroom FROM timetable_lessons WHERE semester=(SELECT semester FROM timetable_sync ORDER BY last_synced_at DESC LIMIT 1)${lessonFilter.sql} GROUP BY course_code ORDER BY name LIMIT ?`,
      )
      .all(...lessonFilter.values, perKindLimit) as LessonRow[],
    (row) => score(row.name) || score(row.code),
  );

  const todos = rankByScore(
    getTodoState().items.filter((item) =>
      matchesAllTokens(`${item.title} ${item.notes} ${item.courseName ?? ''}`, tokens),
    ),
    (item) => score(item.title),
  ).slice(0, perKindLimit);
  return [
    ...todos.map((item) => ({
      kind: 'todo' as const,
      id: item.id,
      title: item.title,
      subtitle: `${item.courseName ?? '个人待办'} · ${todoStatusLabels[item.status]}${item.dueAt ? ` · ${item.dueAt}` : ''}`,
      target: { page: 'todo' as const, todoId: item.id },
    })),
    ...lessons.map((row) => ({
      kind: 'lesson' as const,
      id: row.code,
      title: row.name,
      subtitle:
        [row.teacher, row.classroom].filter((part): part is string => Boolean(part)).join(' · ') ||
        '本学期课表',
      target: { page: 'timetable' as const },
    })),
    ...projects.map((row) => ({
      kind: 'project' as const,
      id: row.id,
      title: row.title,
      subtitle: null,
      target: { page: 'projects' as const, entryId: row.id },
    })),
    ...chats.map((row) => ({
      kind: 'chat' as const,
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      target: { page: 'chat' as const, projectId: row.projectId, sessionId: row.id },
    })),
    ...mail.map((row) => ({
      kind: 'mail' as const,
      id: row.id,
      title: row.subject || '(无主题)',
      subtitle: row.senderName || row.senderAddress || row.snippet,
      target: { page: 'mail' as const, messageId: row.id },
    })),
    ...files.map((row) => ({
      kind: 'course-file' as const,
      id: row.id,
      title: row.title,
      subtitle: row.courseName,
      target: { page: 'sources' as const, sourceId: row.id },
    })),
  ];
}

export function registerSearchIpc(): void {
  ipcMain.handle('search:query', (event, query: unknown) => {
    checkWorkspaceSender(event);
    return queryGlobalSearch(querySchema.parse(query));
  });
}
