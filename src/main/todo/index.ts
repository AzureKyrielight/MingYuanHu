import { BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from '../database';
import { checkWorkspaceSender } from '../ipc';
import { calendarEventColors } from '../../shared/api';
import { nextTodoDue, todoCompleted, todoRepeats, todoReminderDue } from '../../shared/todo';
import type { NotificationItem, TodoItem, TodoState } from '../../shared/api';

const idSchema = z.string().min(1).max(512);
export const todoSaveSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
    completed: z.boolean().optional(),
    calendar: z.boolean().optional(),
    color: z.enum(calendarEventColors).optional(),
    repeat: z.enum(todoRepeats).nullable().optional(),
    remindAt: z.string().datetime().nullable().optional(),
  })
  .strict();
type TodoRow = {
  id: string;
  owner: string;
  data: string;
  read_at: string | null;
  notice_at: string | null;
};

function rows(): TodoRow[] {
  return getDatabase().prepare("SELECT * FROM todo_items WHERE owner='local'").all() as TodoRow[];
}

export function getTodoState(): TodoState {
  return {
    items: rows()
      .map((row) => ({ ...JSON.parse(row.data), readAt: row.read_at }) as TodoItem)
      .sort(
        (a, b) => (a.dueAt ?? 'z').localeCompare(b.dueAt ?? 'z') || a.title.localeCompare(b.title),
      ),
    connected: false,
    syncing: false,
    syncedAt: null,
    error: null,
  };
}

export function broadcastTodos(): TodoState {
  const state = getTodoState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const url = window.webContents.getURL();
    if (
      url.startsWith('http://127.0.0.1:5173/') ||
      (url.startsWith('file:') && /\/renderer\/index\.html(?:\?|$)/.test(url))
    ) {
      window.webContents.send('todo:state', state);
    }
  }
  return state;
}

export function saveTodo(input: unknown): TodoState {
  const value = todoSaveSchema.parse(input);
  const existing = value.id ? rows().find((row) => row.id === value.id) : undefined;
  if (value.id && !existing) throw new Error('待办不存在');
  const old = existing ? (JSON.parse(existing.data) as TodoItem) : undefined;
  const now = new Date().toISOString();
  const item: TodoItem = {
    id: value.id ?? randomUUID(),
    source: 'personal',
    title: value.title,
    notes: value.notes ?? old?.notes ?? '',
    dueAt: value.dueAt === undefined ? (old?.dueAt ?? null) : value.dueAt,
    status:
      value.completed === undefined
        ? (old?.status ?? 'pending')
        : value.completed
          ? 'completed'
          : 'pending',
    calendar: value.calendar ?? old?.calendar ?? false,
    color: value.color ?? old?.color,
    repeat: value.repeat === undefined ? (old?.repeat ?? null) : value.repeat,
    remindAt: value.remindAt === undefined ? (old?.remindAt ?? null) : value.remindAt,
    createdAt: old?.createdAt ?? now,
    readAt: now,
  };
  getDatabase()
    .prepare(
      "INSERT INTO todo_items(id, owner, data, read_at) VALUES (?, 'local', ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    )
    .run(item.id, JSON.stringify(item), now);
  // 提醒时间被改动就重新武装：否则改到更晚的时间也不会再提醒（notice_at 仍是旧值）。
  if (value.remindAt !== undefined && value.remindAt !== (old?.remindAt ?? null))
    getDatabase().prepare('UPDATE todo_items SET notice_at=NULL WHERE id=?').run(item.id);
  rollOverRepeat(item, old, now);
  return broadcastTodos();
}

/**
 * 勾选完成后按重复规则生成下一轮待办：只认「这次真的从未完成变成完成」，
 * 避免重复保存同一条已完成待办时不断复制。提醒时间随截止时间整体平移。
 */
function rollOverRepeat(item: TodoItem, old: TodoItem | undefined, now: string): void {
  if (item.status !== 'completed' || !item.repeat || !item.dueAt) return;
  if (old && todoCompleted(old.status)) return;
  const dueAt = nextTodoDue(item.dueAt, item.repeat);
  if (!dueAt) return;
  const shift = Date.parse(dueAt) - Date.parse(item.dueAt);
  const remindAt =
    item.remindAt && Number.isFinite(shift)
      ? new Date(Date.parse(item.remindAt) + shift).toISOString()
      : null;
  const next: TodoItem = {
    ...item,
    id: randomUUID(),
    status: 'pending',
    dueAt,
    remindAt,
    createdAt: now,
    readAt: null,
  };
  getDatabase()
    .prepare(
      "INSERT INTO todo_items(id, owner, data, read_at) VALUES (?, 'local', ?, NULL) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    )
    .run(next.id, JSON.stringify(next));
}

/**
 * 到点提醒：写入 notice_at 后由通知中心统一展示；同一待办只提醒一次
 * （notice_at 已非空就不再处理），日期或完成状态改变不会让提醒重复响起。
 */
export function runTodoReminders(now = Date.now()): boolean {
  let changed = false;
  for (const row of rows()) {
    if (row.notice_at !== null) continue;
    const item = JSON.parse(row.data) as TodoItem;
    if (!todoReminderDue(item, now)) continue;
    getDatabase()
      .prepare('UPDATE todo_items SET notice_at=? WHERE id=?')
      .run(new Date().toISOString(), row.id);
    changed = true;
  }
  if (changed) broadcastTodos();
  return changed;
}

export function removeTodo(input: unknown): TodoState {
  getDatabase()
    .prepare("DELETE FROM todo_items WHERE id=? AND owner='local'")
    .run(idSchema.parse(input));
  return broadcastTodos();
}

export function markTodoRead(input?: unknown): TodoState {
  const id = input === undefined ? null : idSchema.parse(input);
  getDatabase()
    .prepare(
      "UPDATE todo_items SET read_at=COALESCE(read_at, ?) WHERE owner='local' AND (? IS NULL OR id=?)",
    )
    .run(new Date().toISOString(), id, id);
  return broadcastTodos();
}

export function todoNotifications(): NotificationItem[] {
  return rows()
    .filter((row) => row.notice_at !== null)
    .map((row) => {
      const item = JSON.parse(row.data) as TodoItem;
      return {
        id: `todo:${row.id}`,
        source: 'todo',
        category: null,
        count: 1,
        title: item.title,
        body: '待办提醒',
        createdAt: row.notice_at!,
        readAt: row.read_at,
        href: { kind: 'todo', todoId: item.id },
      };
    });
}

export async function refreshTodos(): Promise<TodoState> {
  return broadcastTodos();
}

export function registerTodoIpc(): void {
  for (const [name, fn] of Object.entries({
    'get-state': getTodoState,
    refresh: refreshTodos,
    save: saveTodo,
    remove: removeTodo,
    'mark-read': (id: unknown) => markTodoRead(idSchema.parse(id)),
  })) {
    ipcMain.handle(`todo:${name}`, (event, input: unknown) => {
      checkWorkspaceSender(event);
      return fn(input);
    });
  }
}
