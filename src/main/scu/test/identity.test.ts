import { describe, expect, it } from 'vitest';
import { sm2 } from 'sm-crypto';
import { encryptPassword, explainLoginError, isCaptchaFailure } from '../identity';

describe('encryptPassword', () => {
  it('输出 base64(04||C1||C2||C3)，且能被同一密钥解回明文', () => {
    const { publicKey, privateKey } = sm2.generateKeyPairHex();
    const publicKeyBase64 = Buffer.from(publicKey, 'hex').toString('base64');
    const encrypted = encryptPassword('SRN,sample:pw>1', publicKeyBase64);
    const bytes = Buffer.from(encrypted, 'base64');
    // 04 + C1(64) + C2(明文长度) + C3(32)
    expect(bytes).toHaveLength(1 + 96 + 'SRN,sample:pw>1'.length);
    expect(bytes[0]).toBe(4);
    expect(sm2.doDecrypt(bytes.subarray(1).toString('hex'), privateKey, 0)).toBe('SRN,sample:pw>1');
  });

  it('公钥缺少 04 前缀时自动补齐', () => {
    const { publicKey, privateKey } = sm2.generateKeyPairHex();
    const withoutPrefix = Buffer.from(publicKey.replace(/^04/, ''), 'hex').toString('base64');
    const encrypted = encryptPassword('中文密码', withoutPrefix);
    const cipher = Buffer.from(encrypted, 'base64').subarray(1).toString('hex');
    expect(sm2.doDecrypt(cipher, privateKey, 0)).toBe('中文密码');
  });

  it('公钥长度异常时拒绝加密', () => {
    expect(() => encryptPassword('x', Buffer.alloc(10).toString('base64'))).toThrow(
      'SM2 公钥格式异常',
    );
  });
});

describe('explainLoginError', () => {
  const body = (message: string): string =>
    JSON.stringify({
      success: false,
      code: '400',
      message,
      data: { error_description: 'invalid_grant', error: 'invalid_grant' },
    });

  it('账号锁定给出等待提示', () => {
    expect(explainLoginError(body('user is locked'), 400)).toBe(
      '账号已被临时锁定（连续登录失败），请约 5 分钟后再试',
    );
  });

  it('剩余尝试次数按 上限-已尝试 计算', () => {
    expect(explainLoginError(body('login_failed_will_lock_2_5'), 400)).toBe(
      '学号或密码不正确（连续失败第 2 次，再错 3 次将临时锁定账号）',
    );
  });

  it('验证码错误单独成句', () => {
    expect(explainLoginError(body('invalid_captcha'), 400)).toBe('验证码错误，请重试');
  });

  it('非 JSON 响应退化为状态码', () => {
    expect(explainLoginError('<html>gateway</html>', 502)).toBe('HTTP 502');
  });
});

describe('isCaptchaFailure', () => {
  it('只把验证码相关问题算作可重试', () => {
    expect(isCaptchaFailure('验证码错误，请重试')).toBe(true);
    expect(isCaptchaFailure('invalid_captcha')).toBe(true);
    expect(isCaptchaFailure('账号已被临时锁定（连续登录失败），请约 5 分钟后再试')).toBe(false);
    expect(isCaptchaFailure('学号或密码不正确（HTTP 400）')).toBe(false);
  });
});
