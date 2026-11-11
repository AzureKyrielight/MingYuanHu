// 邮箱服务器参数的唯一读取口：IMAP 连接（api.ts）与发信（send.ts）都从这里取，
// 避免两边各存一份「校园预设」而漏掉第三方账号。列或值缺失按账号地址回落学生/教工预设，
// 老库（没有 smtp_host/smtp_port 列）与校园账号都走这条回落。
import type { MailServerConfig } from '../../shared/mail';
import { SCU_MAIL_SERVER, scuMailServerFor } from '../../shared/mail';
import { getDatabase } from '../database';

interface ServerRow {
  address: string;
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
}

export function storedMailServer(): MailServerConfig {
  const row = getDatabase()
    .prepare(
      'SELECT address, imap_host, imap_port, smtp_host, smtp_port FROM mail_accounts LIMIT 1',
    )
    .get() as ServerRow | undefined;
  if (!row) return { ...SCU_MAIL_SERVER };
  const fallback = scuMailServerFor(row.address) ?? SCU_MAIL_SERVER;
  return {
    imapHost: row.imap_host || fallback.imapHost,
    imapPort: row.imap_port ?? fallback.imapPort,
    smtpHost: row.smtp_host || fallback.smtpHost,
    smtpPort: row.smtp_port ?? fallback.smtpPort,
  };
}
