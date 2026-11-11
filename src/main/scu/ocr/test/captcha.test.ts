import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng, recognizeCaptchaBase64, recognizeCaptchaPng } from '../captcha';

const fixture = (name: string): Buffer => readFileSync(join(__dirname, 'fixtures', name));

describe('统一认证验证码 OCR', () => {
  it('解析 PNG 头信息', () => {
    const image = decodePng(fixture('captcha.png'));
    expect(image.width).toBe(80);
    expect(image.height).toBe(26);
  });

  it('识别真实样本（3x3p）', () => {
    const result = recognizeCaptchaPng(fixture('captcha.png'));
    expect(result.text).toBe('3x3p');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('支持带 data URL 前缀的 base64', () => {
    const base64 = fixture('captcha.png').toString('base64');
    expect(recognizeCaptchaBase64(`data:image/png;base64,${base64}`).text).toBe('3x3p');
  });

  it('非 PNG 数据报错', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow('不是有效的 PNG 图片');
  });
});
