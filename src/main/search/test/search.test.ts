import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let database: DatabaseSync;

vi.mock('../../todo', () => ({ getTodoState: vi.fn(() => ({ items: [] })) }));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../database', () => ({ getDatabase: () => database }));
vi.mock('../../ipc', () => ({ checkWorkspaceSender: vi.fn() }));

import { queryGlobalSearch } from '..';

function insert(sql: string, ...values: SQLInputValue[]) {
  database.prepare(sql).run(...values);
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  // 影子 schema 必须与 database.ts 的 schema 对齐：列写错会让「代码引用不存在的列」
  // 这类缺陷静默通过（曾经如此：sessions 少了 messages 列时这里补过一列）。
  database.exec(`
    CREATE TABLE workspace_entries (id TEXT PRIMARY KEY, name TEXT, kind TEXT, updated_at TEXT);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES workspace_entries(id) ON DELETE SET NULL,
      file TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      message_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      parent_id TEXT
    );
    CREATE TABLE mail_messages (
      id INTEGER PRIMARY KEY, subject TEXT, sender_name TEXT, sender_address TEXT, snippet TEXT,
      body_text TEXT, date TEXT, deleted_at TEXT
    );
    CREATE TABLE canvas_courses (id INTEGER PRIMARY KEY, data TEXT);
    CREATE TABLE canvas_sources (id TEXT PRIMARY KEY, course_id INTEGER, data TEXT);
    CREATE TABLE timetable_sync (semester TEXT PRIMARY KEY, last_synced_at TEXT NOT NULL, semester_start TEXT);
    CREATE TABLE timetable_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      semester TEXT NOT NULL,
      source_id TEXT NOT NULL,
      course_code TEXT NOT NULL,
      course_name TEXT NOT NULL,
      class_name TEXT,
      teacher TEXT,
      campus TEXT,
      classroom TEXT,
      weekday INTEGER NOT NULL,
      start_period INTEGER NOT NULL,
      end_period INTEGER NOT NULL,
      periods_text TEXT NOT NULL,
      weeks_text TEXT NOT NULL,
      week_numbers TEXT NOT NULL,
      credits REAL,
      note TEXT
    );
  `);
});

describe('global search', () => {
  it('matches literal LIKE characters instead of treating them as wildcards', () => {
    insert(
      'INSERT INTO mail_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      1,
      '100%_! exact',
      '老师',
      'teacher@example.test',
      null,
      null,
      '2026-09-16T12:00:00.000Z',
      null,
    );
    insert(
      'INSERT INTO mail_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      2,
      '100xx exact',
      '老师',
      'teacher@example.test',
      null,
      null,
      '2026-09-16T11:00:00.000Z',
      null,
    );

    expect(queryGlobalSearch('100%_! exact').filter((item) => item.kind === 'mail')).toEqual([
      expect.objectContaining({ id: 1 }),
    ]);
  });

  it('searches chat titles and returns project identities', () => {
    insert(
      'INSERT INTO workspace_entries VALUES (?, ?, ?, ?)',
      'project-1',
      '毕业设计',
      'project',
      '2026-09-16T12:00:00.000Z',
    );
    insert(
      'INSERT INTO sessions (id, project_id, file, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      'chat-content',
      'project-1',
      'sessions/chat-content.jsonl',
      '资料讨论',
      '2026-09-16T12:00:00.000Z',
      '2026-09-16T12:00:00.000Z',
    );
    insert(
      'INSERT INTO sessions (id, project_id, file, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      'chat-tools',
      null,
      'sessions/chat-tools.jsonl',
      '工具结果',
      '2026-09-16T11:00:00.000Z',
      '2026-09-16T11:00:00.000Z',
    );

    expect(queryGlobalSearch('资料讨论')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'chat',
          id: 'chat-content',
          subtitle: '毕业设计',
          target: { page: 'chat', projectId: 'project-1', sessionId: 'chat-content' },
        }),
      ]),
    );
    // 通用会话（project_id NULL）深链回到首页。
    expect(queryGlobalSearch('工具结果')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'chat',
          id: 'chat-tools',
          subtitle: '首页',
          target: { page: 'chat', projectId: null, sessionId: 'chat-tools' },
        }),
      ]),
    );
    // 正文在 Pi 的 JSONL 会话文件里，sessions 表不存消息，因此正文不参与匹配。
    expect(queryGlobalSearch('散热方案').filter((item) => item.kind === 'chat')).toHaveLength(0);
    // 子 Agent 的会话只从父会话的工具卡片进入，不进搜索。
    insert(
      'INSERT INTO sessions (id, project_id, file, title, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'chat-child',
      'project-1',
      '',
      '资料讨论子任务',
      'chat-content',
      '2026-09-16T13:00:00.000Z',
      '2026-09-16T13:00:00.000Z',
    );
    expect(queryGlobalSearch('资料讨论').map((item) => item.id)).not.toContain('chat-child');
    expect(queryGlobalSearch('').map((item) => item.id)).not.toContain('chat-child');
  });

  it('returns cached Canvas filenames only and ignores deleted mail', () => {
    insert('INSERT INTO canvas_courses VALUES (?, ?)', 1, JSON.stringify({ name: '信号与系统' }));
    insert(
      'INSERT INTO canvas_sources VALUES (?, ?, ?)',
      'file:1',
      1,
      JSON.stringify({ id: 'file:1', kind: 'file', title: 'lecture-notes.pdf' }),
    );
    insert(
      'INSERT INTO canvas_sources VALUES (?, ?, ?)',
      'assignment:1',
      1,
      JSON.stringify({ id: 'assignment:1', kind: 'assignment', title: 'lecture-notes.pdf' }),
    );
    insert(
      'INSERT INTO mail_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      3,
      '已删除的 lecture-notes.pdf',
      null,
      null,
      null,
      null,
      '2026-09-16T12:00:00.000Z',
      '2026-09-16T12:01:00.000Z',
    );

    const results = queryGlobalSearch('lecture-notes.pdf');
    expect(results.filter((item) => item.kind === 'course-file')).toEqual([
      expect.objectContaining({ id: 'file:1', subtitle: '信号与系统' }),
    ]);
    expect(results.filter((item) => item.kind === 'mail')).toHaveLength(0);
  });

  it('caps each result category at ten records', () => {
    for (let index = 0; index < 11; index += 1)
      insert(
        'INSERT INTO workspace_entries VALUES (?, ?, ?, ?)',
        `project-${index}`,
        '同名项目',
        'project',
        `2026-09-16T12:00:${String(index).padStart(2, '0')}.000Z`,
      );

    expect(queryGlobalSearch('同名项目').filter((item) => item.kind === 'project')).toHaveLength(
      10,
    );
  });

  it('requires every whitespace-separated keyword to match', () => {
    insert(
      'INSERT INTO workspace_entries VALUES (?, ?, ?, ?)',
      'project-1',
      '编译原理 课程设计',
      'project',
      '2026-09-16T12:00:00.000Z',
    );
    insert(
      'INSERT INTO workspace_entries VALUES (?, ?, ?, ?)',
      'project-2',
      '编译原理 实验报告',
      'project',
      '2026-09-16T11:00:00.000Z',
    );

    expect(queryGlobalSearch('编译 设计').map((item) => item.id)).toEqual(['project-1']);
    // 顺序无关，且全角空格同样作分隔符。
    expect(queryGlobalSearch('设计　编译').map((item) => item.id)).toEqual(['project-1']);
    expect(queryGlobalSearch('编译 不存在').map((item) => item.id)).toEqual([]);
  });

  it('ranks exact and prefix title hits before substring hits', () => {
    for (const [id, name] of [
      ['project-substring', '高级编译原理'],
      ['project-exact', '编译原理'],
      ['project-prefix', '编译原理课程设计'],
    ] as const)
      insert(
        'INSERT INTO workspace_entries VALUES (?, ?, ?, ?)',
        id,
        name,
        'project',
        '2026-09-16T12:00:00.000Z',
      );

    expect(queryGlobalSearch('编译原理').map((item) => item.id)).toEqual([
      'project-exact',
      'project-prefix',
      'project-substring',
    ]);
  });

  it('searches the latest semester timetable by course, teacher and classroom', () => {
    insert(
      'INSERT INTO timetable_sync VALUES (?, ?, ?)',
      '2026-2027-1',
      '2026-09-01T00:00:00.000Z',
      null,
    );
    insert(
      'INSERT INTO timetable_sync VALUES (?, ?, ?)',
      '2025-2026-2',
      '2026-03-01T00:00:00.000Z',
      null,
    );
    const lesson = (
      semester: string,
      code: string,
      name: string,
      teacher: string,
      classroom: string,
    ) =>
      insert(
        'INSERT INTO timetable_lessons (semester, source_id, course_code, course_name, class_name, teacher, campus, classroom, weekday, start_period, end_period, periods_text, weeks_text, week_numbers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        semester,
        `${semester}:${code}`,
        code,
        name,
        '1 班',
        teacher,
        '江安',
        classroom,
        1,
        1,
        2,
        '1-2',
        '1-16',
        '1,2,3',
      );
    lesson('2025-2026-2', '311001', '数据结构（旧学期）', '王老师', '一教 A101');
    lesson('2026-2027-1', '311001', '数据结构', '王老师', '一教 A101');
    lesson('2026-2027-1', '311002', '操作系统', '李老师', '二教 B202');

    const byTeacher = queryGlobalSearch('王老师').filter((item) => item.kind === 'lesson');
    expect(byTeacher).toEqual([
      expect.objectContaining({
        id: '311001',
        title: '数据结构',
        subtitle: '王老师 · 一教 A101',
        target: { page: 'timetable' },
      }),
    ]);
    // 教室同样参与匹配。
    expect(queryGlobalSearch('B202').map((item) => item.title)).toContain('操作系统');
    // 旧学期的同名课程不会重复出现。
    expect(queryGlobalSearch('311001').filter((item) => item.kind === 'lesson')).toHaveLength(1);
  });
});
