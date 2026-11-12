import { describe, expect, it } from 'vitest';
import { CookieJar, parseSetCookie, seedCookie } from '../cookie-jar';

const URL_BASE = 'https://service.scu.edu.cn/newservice/api/login/cas';

describe('parseSetCookie', () => {
  it('缺省 Domain 时是 host-only，路径与 Secure 取自属性', () => {
    const cookie = parseSetCookie('PHPSESSID=abc; Path=/newservice; Secure; HttpOnly', URL_BASE);
    expect(cookie).toMatchObject({
      name: 'PHPSESSID',
      value: 'abc',
      domain: 'service.scu.edu.cn',
      hostOnly: true,
      path: '/newservice',
      secure: true,
      expiresAt: 0,
    });
  });

  it('Domain 去掉前导点并允许子域共享', () => {
    const cookie = parseSetCookie('CASTGC=TGT-1; Domain=.scu.edu.cn; Path=/', URL_BASE);
    expect(cookie).toMatchObject({ domain: 'scu.edu.cn', hostOnly: false });
  });

  it('Domain 与请求主机不匹配时拒收', () => {
    expect(parseSetCookie('x=1; Domain=other.edu.cn', URL_BASE)).toBeNull();
  });

  it('Max-Age 换算成绝对过期时间，0 表示删除', () => {
    const now = Date.now();
    const alive = parseSetCookie('a=1; Max-Age=60', URL_BASE);
    expect(alive?.expiresAt).toBeGreaterThanOrEqual(now + 59_000);
    expect(parseSetCookie('a=1; Max-Age=0', URL_BASE)?.expiresAt).toBe(1);
  });
});

describe('CookieJar', () => {
  it('按域名与路径下发 Cookie，路径长的在前', () => {
    // 浏览器约定：Domain 带前导点表示域 cookie，不带点是 host-only。
    const jar = new CookieJar([
      seedCookie({ name: 'root', value: '1', domain: '.scu.edu.cn' }),
      seedCookie({ name: 'svc', value: '2', domain: 'service.scu.edu.cn' }),
      seedCookie({ name: 'deep', value: '3', domain: 'service.scu.edu.cn', path: '/newservice' }),
    ]);
    // 同长度路径之间的顺序未规定，只断言路径长的在前与集合完整。
    const sent = jar.header(URL_BASE).split('; ');
    expect(sent[0]).toBe('deep=3');
    expect(new Set(sent)).toEqual(new Set(['deep=3', 'svc=2', 'root=1']));
    expect(jar.header('https://dekt.scu.edu.cn/')).toBe('root=1');
  });

  it('host-only cookie 不下发给子域', () => {
    const jar = new CookieJar([seedCookie({ name: 'id', value: '1', domain: 'id.scu.edu.cn' })]);
    expect(jar.header('https://id.scu.edu.cn/login')).toBe('id=1');
    expect(jar.header('https://other.scu.edu.cn/')).toBe('');
  });

  it('Secure cookie 只在 https 下发送', () => {
    const jar = new CookieJar([
      seedCookie({ name: 's', value: '1', domain: '.scu.edu.cn', secure: true }),
    ]);
    expect(jar.header('http://service.scu.edu.cn/')).toBe('');
    expect(jar.header('https://service.scu.edu.cn/')).toBe('s=1');
  });

  it('同名同域同路径的 Set-Cookie 覆盖旧值，Max-Age=0 删除', () => {
    const jar = new CookieJar();
    jar.store('sid=old; Path=/', URL_BASE);
    jar.store('sid=new; Path=/', URL_BASE);
    expect(jar.header(URL_BASE)).toBe('sid=new');
    jar.store('sid=gone; Path=/; Max-Age=0', URL_BASE);
    expect(jar.header(URL_BASE)).toBe('');
  });

  it('过期的 cookie 不再下发', () => {
    const jar = new CookieJar();
    jar.store('old=1; Expires=Thu, 01 Jan 1970 00:00:01 GMT', URL_BASE);
    expect(jar.list()).toHaveLength(0);
    expect(jar.header(URL_BASE)).toBe('');
  });

  it('drop 只清掉匹配的域名', () => {
    const jar = new CookieJar([
      seedCookie({ name: 'id', value: '1', domain: 'id.scu.edu.cn' }),
      seedCookie({ name: 'svc', value: '2', domain: 'service.scu.edu.cn' }),
    ]);
    jar.drop((cookie) => cookie.domain === 'id.scu.edu.cn');
    expect(jar.list().map((cookie) => cookie.name)).toEqual(['svc']);
  });
});
