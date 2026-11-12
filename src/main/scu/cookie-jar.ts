/** 校园分区 cookie 容器：对齐 SCU-CLI（Go net/http cookiejar）的匹配与过期语义。
 *  只做纯函数与内存状态，便于单测；传输层在 client.ts。 */

export interface JarCookie {
  readonly name: string;
  readonly value: string;
  /** 无前导点的小写域名。 */
  readonly domain: string;
  readonly hostOnly: boolean;
  readonly path: string;
  readonly secure: boolean;
  /** 毫秒时间戳；0 表示会话 cookie，1 表示应删除（Max-Age<=0）。 */
  readonly expiresAt: number;
}

const DELETE_MARK = 1;

function domainMatches(host: string, cookie: Pick<JarCookie, 'domain' | 'hostOnly'>): boolean {
  return cookie.hostOnly
    ? host === cookie.domain
    : host === cookie.domain || host.endsWith(`.${cookie.domain}`);
}

function pathMatches(pathname: string, cookiePath: string): boolean {
  if (cookiePath === '/') return true;
  if (pathname === cookiePath) return true;
  return pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
}

/** 解析一条 Set-Cookie；Domain 与请求主机不匹配时返回 null（浏览器会拒收）。 */
export function parseSetCookie(raw: string, requestUrl: string): JarCookie | null {
  const [pair = '', ...attributes] = raw.split(';');
  const at = pair.indexOf('=');
  if (at <= 0) return null;
  const name = pair.slice(0, at).trim();
  const value = pair.slice(at + 1).trim();
  if (!name) return null;

  const host = new URL(requestUrl).hostname.toLowerCase();
  let domain = host;
  let hostOnly = true;
  let path = '/';
  let secure = false;
  let expiresAt = 0;

  for (const attribute of attributes) {
    const index = attribute.indexOf('=');
    const key = (index === -1 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
    const attributeValue = index === -1 ? '' : attribute.slice(index + 1).trim();
    if (key === 'domain' && attributeValue) {
      domain = attributeValue.replace(/^\./, '').toLowerCase();
      hostOnly = false;
    } else if (key === 'path' && attributeValue.startsWith('/')) {
      path = attributeValue;
    } else if (key === 'secure') {
      secure = true;
    } else if (key === 'max-age' && attributeValue) {
      const seconds = Number(attributeValue);
      if (Number.isFinite(seconds))
        expiresAt = seconds <= 0 ? DELETE_MARK : Date.now() + seconds * 1000;
    } else if (key === 'expires' && attributeValue) {
      const parsed = Date.parse(attributeValue);
      if (!Number.isNaN(parsed)) expiresAt = parsed;
    }
  }

  if (!domainMatches(host, { domain, hostOnly })) return null;
  return { name, value, domain, hostOnly, path, secure, expiresAt };
}

/** 把 Electron session 里的 cookie 转成 jar 条目。 */
export function seedCookie(input: {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  expirationDate?: number;
  session?: boolean;
}): JarCookie {
  return {
    name: input.name,
    value: input.value,
    domain: input.domain.replace(/^\./, '').toLowerCase(),
    hostOnly: !input.domain.startsWith('.'),
    path: input.path?.startsWith('/') ? input.path : '/',
    secure: input.secure === true,
    expiresAt: input.session || !input.expirationDate ? 0 : Math.round(input.expirationDate * 1000),
  };
}

export class CookieJar {
  private cookies: JarCookie[];

  constructor(seedCookies: readonly JarCookie[] = []) {
    this.cookies = [...seedCookies];
  }

  store(rawSetCookie: string, requestUrl: string): void {
    const cookie = parseSetCookie(rawSetCookie, requestUrl);
    if (!cookie) return;
    const index = this.cookies.findIndex(
      (item) =>
        item.name === cookie.name && item.domain === cookie.domain && item.path === cookie.path,
    );
    if (index >= 0) this.cookies.splice(index, 1);
    if (
      cookie.expiresAt === DELETE_MARK ||
      (cookie.expiresAt !== 0 && cookie.expiresAt <= Date.now())
    )
      return;
    this.cookies.push(cookie);
  }

  /** 按 RFC 6265 组 Cookie 头：路径长的在前，跳过过期、错协议与不安全的 Secure cookie。 */
  header(url: string, now = Date.now()): string {
    const target = new URL(url);
    const host = target.hostname.toLowerCase();
    return this.cookies
      .filter(
        (cookie) =>
          domainMatches(host, cookie) &&
          pathMatches(target.pathname || '/', cookie.path) &&
          (cookie.expiresAt === 0 || cookie.expiresAt > now) &&
          (!cookie.secure || target.protocol === 'https:'),
      )
      .sort((a, b) => b.path.length - a.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  list(now = Date.now()): readonly JarCookie[] {
    return this.cookies.filter((cookie) => cookie.expiresAt === 0 || cookie.expiresAt > now);
  }

  /** 丢弃匹配的 cookie：重新登录统一认证时清掉旧会话，避免脏 CASTGC 让 CAS 回 401。 */
  drop(predicate: (cookie: JarCookie) => boolean): void {
    this.cookies = this.cookies.filter((cookie) => !predicate(cookie));
  }

  /** 写入或覆盖一条 cookie（同名同域同路径替换）。 */
  upsert(cookie: JarCookie): void {
    if (cookie.expiresAt !== 0 && cookie.expiresAt <= Date.now()) return;
    const index = this.cookies.findIndex(
      (item) =>
        item.name === cookie.name && item.domain === cookie.domain && item.path === cookie.path,
    );
    if (index >= 0) this.cookies.splice(index, 1, cookie);
    else this.cookies.push(cookie);
  }
}
