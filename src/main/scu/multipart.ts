/**
 * 极简 multipart/form-data 构造：校园子站（办事大厅附件、报修图片、云打印上传）
 * 都要求显式 Content-Length 与 UTF-8 文件名，这里统一按浏览器 FormData 的形态拼装。
 */

export interface MultipartFilePart {
  readonly field: string;
  readonly filename: string;
  readonly contentType?: string;
  readonly data: Uint8Array;
}

export interface MultipartFieldPart {
  readonly field: string;
  readonly value: string;
}

export type MultipartPart = MultipartFilePart | MultipartFieldPart;

export interface MultipartBody {
  readonly body: Uint8Array;
  readonly contentType: string;
}

const encoder = new TextEncoder();

/** 文件名只转义反斜杠与引号：旧服务器不接受 `filename*=`，需保留 UTF-8 原名。 */
const escapeFilename = (name: string) => name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function buildMultipart(parts: readonly MultipartPart[]): MultipartBody {
  const boundary = `----mingyuanhu${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    if ('value' in part) {
      chunks.push(
        encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.field}"\r\n\r\n${part.value}\r\n`,
        ),
      );
      continue;
    }
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.field}"; filename="${escapeFilename(
          part.filename,
        )}"\r\nContent-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`,
      ),
      part.data,
      encoder.encode('\r\n'),
    );
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  heif: 'image/heif',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

export function contentTypeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}
