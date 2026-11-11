export const notificationSources = ['mail', 'todo'] as const;
export type NotificationSource = (typeof notificationSources)[number];
export type NotificationCategory = 'like' | 'reply' | 'mention' | 'message' | 'other';
export interface NotificationItem {
  id: string;
  source: NotificationSource;
  category: NotificationCategory | null;
  count: number;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  href: { kind: 'todo'; todoId: string } | { kind: 'mail'; messageId: number };
}
export interface NotificationState {
  items: readonly NotificationItem[];
  totalCount: number;
  unreadCount: number;
  snoozedUntil: string | null;
  refresh: Record<
    NotificationSource,
    { lastSuccessAt: string | null; error: string | null } | null
  >;
}
export interface NotificationsApi {
  getState(sources?: readonly NotificationSource[]): Promise<NotificationState>;
  refresh(): Promise<NotificationState>;
  markRead(id: string): Promise<NotificationState>;
  markAllRead(sources?: readonly NotificationSource[]): Promise<NotificationState>;
  setSnooze(until: string | null): Promise<NotificationState>;
  onUpdate(listener: (state: NotificationState) => void): () => void;
  onOpen(listener: (item: NotificationItem) => void): () => void;
}
