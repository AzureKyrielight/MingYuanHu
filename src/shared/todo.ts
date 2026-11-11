import type { CalendarEventColor } from './timetable';

/** 个人待办支持的重复杂粒度；Canvas 作业永远不带重复。 */
export const todoRepeats = ['daily', 'weekly', 'monthly'] as const;
export type TodoRepeat = (typeof todoRepeats)[number];

export const todoRepeatLabels: Record<TodoRepeat, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

/**
 * 下一轮截止时间：按自然日/周/月推进并保留原来的时分秒。
 * 跨月时把日期钳到目标月最后一天（1 月 31 日 + 1 个月 = 2 月 28/29 日），
 * 避免 JS 默认的「3 月 3 日」跳跃。输入非法时返回 null。
 */
export function nextTodoDue(dueAt: string, repeat: TodoRepeat): string | null {
  const current = new Date(dueAt);
  if (Number.isNaN(current.getTime())) return null;
  const next = new Date(current.getTime());
  if (repeat === 'daily') next.setDate(next.getDate() + 1);
  else if (repeat === 'weekly') next.setDate(next.getDate() + 7);
  else {
    const day = current.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
  }
  return Number.isNaN(next.getTime()) ? null : next.toISOString();
}

/** 提醒时间是否已到（到点后由主进程写入通知中心，同一待办只提醒一次）。 */
export function todoReminderDue(item: Pick<TodoItem, 'remindAt' | 'status'>, now: number): boolean {
  if (!item.remindAt || todoCompleted(item.status)) return false;
  const at = Date.parse(item.remindAt);
  return !Number.isNaN(at) && at <= now;
}

export type TodoStatus =
  'pending' | 'completed' | 'submitted' | 'graded' | 'excused' | 'resubmit' | 'offline' | 'unknown';
export interface TodoItem {
  id: string;
  source: 'personal' | 'canvas';
  title: string;
  notes: string;
  dueAt: string | null;
  status: TodoStatus;
  readAt: string | null;
  createdAt: string;
  /** 仅个人待办：开启后在日历（周/月视图）中按截止时间显示。 */
  calendar?: boolean;
  /** 仅个人待办：写入日历时的候选色；未选时渲染回退石墨色。 */
  color?: CalendarEventColor;
  /** 仅个人待办：完成后自动按此粒度生成下一条待办。 */
  repeat?: TodoRepeat | null;
  /** 仅个人待办：到点写入通知中心（ISO 时间）。 */
  remindAt?: string | null;
  courseId?: number;
  /** Canvas 课程代码；月历与课表共用它生成稳定的课程颜色。 */
  courseCode?: string;
  courseName?: string;
  assignmentId?: number;
  url?: string;
  /** 仅 Canvas 作业：作业描述原始 HTML，随作业同步缓存，renderer 经沙箱 iframe 渲染。 */
  description?: string;
  submittedAt?: string | null;
  syncedAt?: string;
}
export interface TodoState {
  items: TodoItem[];
  connected: boolean;
  syncing: boolean;
  syncedAt: string | null;
  error: string | null;
}
export interface TodoSaveInput {
  id?: string;
  title: string;
  notes?: string;
  dueAt?: string | null;
  completed?: boolean;
  calendar?: boolean;
  color?: CalendarEventColor;
  /** 传 null 表示关闭重复；不传保持原值。 */
  repeat?: TodoRepeat | null;
  /** 传 null 表示关闭提醒；不传保持原值。 */
  remindAt?: string | null;
}
export interface TodoApi {
  getState(): Promise<TodoState>;
  refresh(): Promise<TodoState>;
  save(input: TodoSaveInput): Promise<TodoState>;
  remove(id: string): Promise<TodoState>;
  markRead(id: string): Promise<TodoState>;
  onUpdate(listener: (state: TodoState) => void): () => void;
}

export const todoStatusLabels: Record<TodoStatus, string> = {
  pending: '未完成',
  completed: '已完成',
  submitted: '已提交',
  graded: '已批改',
  excused: '已豁免',
  resubmit: '需重新提交',
  offline: '线下 / 无需在线提交',
  unknown: '待同步确认',
};

export function todoCompleted(status: TodoStatus): boolean {
  return ['completed', 'submitted', 'graded', 'excused'].includes(status);
}

/** 仅按 Canvas 明确返回的提交事实判定；成绩（包括零分）本身不代表完成。 */
export function canvasTodoStatus(assignment: Record<string, unknown>): TodoStatus {
  const sub = assignment.submission as Record<string, unknown> | null | undefined;
  if (!sub || typeof sub !== 'object') return 'unknown';
  if (sub.excused === true) return 'excused';
  if (sub.redo_request === true) return 'resubmit';
  if (
    sub.submitted_at ||
    sub.workflow_state === 'submitted' ||
    sub.workflow_state === 'pending_review'
  ) {
    return sub.workflow_state === 'graded' ? 'graded' : 'submitted';
  }
  const types = assignment.submission_types;
  if (
    Array.isArray(types) &&
    types.every((type) => type === 'on_paper' || type === 'none') &&
    types.length
  ) {
    return sub.workflow_state === 'graded' && sub.missing !== true ? 'graded' : 'offline';
  }
  if (
    sub.workflow_state === 'unsubmitted' ||
    sub.missing === true ||
    sub.workflow_state === 'graded'
  )
    return 'pending';
  return 'unknown';
}
