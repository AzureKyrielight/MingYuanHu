export interface MailAddress {
  readonly name: string | null;
  readonly address: string | null;
}

export interface MailAttachmentInfo {
  readonly filename: string;
  readonly size: number | null;
  readonly part: string | null;
}

export interface MailFolderInfo {
  readonly id: number;
  readonly path: string;
  readonly name: string;
  readonly specialUse: string | null;
  readonly total: number | null;
  readonly unread: number | null;
  readonly lastSyncedAt: string | null;
}

export interface MailMessageSummary {
  readonly id: number;
  readonly uid: number;
  readonly subject: string | null;
  readonly sender: MailAddress | null;
  readonly date: string | null;
  readonly seen: boolean;
  readonly flagged: boolean;
  readonly hasAttachments: boolean;
  readonly snippet: string | null;
  readonly size: number | null;
}

export interface MailMessageDetail extends MailMessageSummary {
  readonly folderId?: number;
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly bodyText: string | null;
  readonly bodyHtml: string | null;
  readonly attachments: readonly MailAttachmentInfo[];
}

/** 回收站条目：本地删除的缓存邮件，附原文件夹名与删除时间。 */
export interface MailTrashItem extends MailMessageSummary {
  readonly folderName: string | null;
  readonly deletedAt: string;
}

/** 本地回收站保留天数；0 表示永久保留。 */
export type MailTrashRetention = 7 | 30 | 90 | 0;

export type MailSyncPhase = 'idle' | 'connecting' | 'syncing' | 'error';

export interface MailSyncStatus {
  readonly phase: MailSyncPhase;
  readonly folderPath: string | null;
  readonly processed: number;
  readonly total: number | null;
  readonly error: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface MailAccountInfo {
  readonly address: string;
  readonly lastSyncedAt: string | null;
}

export interface MailState {
  readonly account: MailAccountInfo | null;
  readonly sync: MailSyncStatus;
}

export type MailResult =
  { readonly ok: true; readonly warning?: string } | { readonly ok: false; readonly error: string };

/** 邮箱服务器参数：川大邮箱与第三方 IMAP 共用同一套字段，SSL/TLS 固定开启。 */
export interface MailServerConfig {
  readonly imapHost: string;
  readonly imapPort: number;
  readonly smtpHost: string;
  readonly smtpPort: number;
}

/** 川大教工邮箱预设；第三方账号由用户自填。 */
export const SCU_MAIL_SERVER: MailServerConfig = {
  imapHost: 'mail.scu.edu.cn',
  imapPort: 993,
  smtpHost: 'mail.scu.edu.cn',
  smtpPort: 465,
};

/**
 * 川大学生邮箱预设（Coremail 学生邮局）。
 * 网页入口是 https://mail.stu.scu.edu.cn，但它 CNAME 到 edu.icoremail.net，
 * 服务器证书只覆盖 *.icoremail.net；直接用别名会触发 TLS 主机名不匹配，
 * 因此 IMAP/SMTP 必须连接 CNAME 目标 edu.icoremail.net。
 */
export const SCU_STUDENT_MAIL_SERVER: MailServerConfig = {
  imapHost: 'edu.icoremail.net',
  imapPort: 993,
  smtpHost: 'edu.icoremail.net',
  smtpPort: 465,
};

/** 按校园邮箱地址选择预设；非川大地址返回 null（需要用户自填服务器）。 */
export function scuMailServerFor(address: string): MailServerConfig | null {
  const value = address.trim().toLowerCase();
  if (value.endsWith('@stu.scu.edu.cn')) return SCU_STUDENT_MAIL_SERVER;
  if (value.endsWith('@scu.edu.cn')) return SCU_MAIL_SERVER;
  return null;
}

/**
 * 川大邮箱登录名归一化：学号补 @stu.scu.edu.cn，漏写 @ 的 `学号stu.scu.edu.cn`
 * 也能补回。第三方 IMAP 不走这里（用户名就是完整地址）。
 */
export function normalizeScuMailAddress(input: string): string {
  const value = input.trim().toLowerCase();
  if (!value) return value;
  if (value.includes('@')) return value;
  if (/^\d{6,}$/.test(value)) return `${value}@stu.scu.edu.cn`;
  const domain = /^(.*?)(stu\.scu\.edu\.cn|scu\.edu\.cn)$/.exec(value);
  if (domain?.[1]) return `${domain[1]}@${domain[2]}`;
  return value;
}

export interface MailConfigureInput {
  readonly address: string;
  readonly password: string;
  /** 不传即川大邮箱预设；第三方 IMAP 传自填的服务器参数。 */
  readonly server?: MailServerConfig;
}

export type MailComposeFileKind = 'attachment' | 'inline';

export interface MailComposeFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly kind: MailComposeFileKind;
  readonly previewUrl: string | null;
}

export interface PreparedEmail {
  id: string;
  to: string[];
  subject: string;
  text: string;
  files: MailComposeFile[];
  html?: string;
  savedLocally?: boolean;
  recipientText?: string;
}

export interface MailDraftInput {
  id?: string;
  account: string;
  recipientText: string;
  subject: string;
  text: string;
  html: string;
  attachmentIds: string[];
  inlineImageIds: string[];
}

export interface MailDraftSummary {
  id: string;
  subject: string;
  recipientText: string;
  updatedAt: string;
}

export interface MailSendInput {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly attachmentIds: readonly string[];
  readonly inlineImageIds: readonly string[];
}

export interface MailApi {
  getState(): Promise<MailState>;
  configure(input: MailConfigureInput): Promise<MailResult>;
  disconnect(): Promise<MailResult>;
  listFolders(): Promise<readonly MailFolderInfo[]>;
  listMessages(folderId: number, limit: number): Promise<readonly MailMessageSummary[]>;
  getMessage(messageId: number): Promise<MailMessageDetail>;
  markSeen(messageId: number): Promise<MailResult>;
  deleteMessage(messageId: number): Promise<MailResult>;
  restoreMessage(messageId: number): Promise<MailResult>;
  purgeMessage(messageId: number): Promise<MailResult>;
  emptyTrash(): Promise<MailResult>;
  listTrash(): Promise<readonly MailTrashItem[]>;
  getTrashRetention(): Promise<MailTrashRetention>;
  setTrashRetention(retention: MailTrashRetention): Promise<MailTrashRetention>;
  downloadAttachment(messageId: number, part: string): Promise<MailResult>;
  pickComposeFiles(kind: MailComposeFileKind): Promise<readonly MailComposeFile[]>;
  addComposeImage(dataUrl: string): Promise<MailComposeFile>;
  releaseComposeFiles(ids: readonly string[]): Promise<void>;
  sendMessage(input: MailSendInput): Promise<MailResult>;
  openDraft(id: string): Promise<PreparedEmail>;
  saveDraft(input: MailDraftInput): Promise<MailDraftSummary>;
  listDrafts(account: string): Promise<MailDraftSummary[]>;
  deleteDraft(id: string): Promise<void>;
  confirmDraftClose(): Promise<'save' | 'discard' | 'cancel'>;
  setComposeActive(active: boolean): Promise<void>;
  onRequestClose(listener: (quitting: boolean) => void): () => void;
  syncNow(): Promise<void>;
  onSyncStatus(listener: (status: MailSyncStatus) => void): () => void;
}
