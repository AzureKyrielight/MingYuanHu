// 统一身份认证登录探针（本地调试用，不进入安装包）。
// 凭据只从环境变量读取，不写日志；连续失败会触发学校账号锁定，慎用。
//   captcha:     取验证码图片，输出 code 与图片路径；
//   ocr:         取验证码并输出本地 OCR 结果（不登录，无锁定风险）；
//   interactive: 同进程取验证码 → 等待 captcha.txt 写入识别结果 → 登录；
//   auto:        取验证码 → OCR → 登录（单次，不重试密码）；
//   login:       直接用环境变量 SCU_CAPTCHA_CODE / SCU_CAPTCHA_TEXT 登录。
// 只打印登录状态与密码指纹，不打印密码或 token。
import { app, session } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CAMPUS_PARTITION } from '../src/main/campus';
import { fetchLoginCaptcha, identityState, loginWithPassword } from '../src/main/scu/identity';
import { recognizeCaptchaBase64 } from '../src/main/scu/ocr/captcha';

const mode = process.env.SCU_PROBE_MODE ?? 'captcha';
const dir = join(tmpdir(), 'mingyuanhu-scu-probe');
const answerPath = join(dir, 'captcha.txt');

async function clearIdCookies(): Promise<number> {
  const campus = session.fromPartition(CAMPUS_PARTITION);
  const cookies = await campus.cookies.get({ domain: 'scu.edu.cn' });
  await campus.clearStorageData({ origin: 'https://id.scu.edu.cn', storages: ['cookies'] });
  return cookies.length;
}

function base64Payload(image: string): string {
  return image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
}

/** 只输出长度与指纹，便于比对 shell 是否改写了特殊字符。 */
function passwordFingerprint(secret: string): { length: number; sha256: string } {
  return {
    length: secret.length,
    sha256: createHash('sha256').update(secret).digest('hex').slice(0, 12),
  };
}

async function waitForAnswer(timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(answerPath)) {
      const text = readFileSync(answerPath, 'utf8').trim();
      if (text) return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('等待验证码识别结果超时');
}

app
  .whenReady()
  .then(async () => {
    mkdirSync(dir, { recursive: true });
    if (mode === 'captcha') {
      const captcha = await fetchLoginCaptcha();
      const path = join(dir, 'captcha.png');
      writeFileSync(path, Buffer.from(base64Payload(captcha.image), 'base64'));
      console.log(JSON.stringify({ result: 'captcha', code: captcha.code, path }));
    } else if (mode === 'ocr') {
      const captcha = await fetchLoginCaptcha();
      const path = join(dir, 'captcha.png');
      writeFileSync(path, Buffer.from(base64Payload(captcha.image), 'base64'));
      const recognition = recognizeCaptchaBase64(captcha.image);
      console.log(JSON.stringify({ result: 'ocr', code: captcha.code, path, ...recognition }));
    } else if (mode === 'cookies') {
      const campus = session.fromPartition(CAMPUS_PARTITION);
      const cookies = await campus.cookies.get({ domain: 'scu.edu.cn' });
      console.log(
        JSON.stringify({
          result: 'cookies',
          count: cookies.length,
          names: cookies.map((cookie) => `${cookie.domain}${cookie.path}:${cookie.name}`),
        }),
      );
    } else if (mode === 'auto-clean') {
      const removed = await clearIdCookies();
      const captcha = await fetchLoginCaptcha();
      const path = join(dir, 'captcha.png');
      writeFileSync(path, Buffer.from(base64Payload(captcha.image), 'base64'));
      const recognition = recognizeCaptchaBase64(captcha.image);
      console.log(JSON.stringify({ result: 'ocr', removedCookies: removed, path, ...recognition }));
      const state = await loginWithPassword({
        username: process.env.SCU_USERNAME ?? '',
        password: process.env.SCU_PASSWORD ?? '',
        captchaCode: captcha.code,
        captchaText: recognition.text,
      });
      console.log(JSON.stringify({ result: 'login', state, after: identityState() }));
    } else if (mode === 'auto') {
      const secret = process.env.SCU_PASSWORD ?? '';
      console.log(JSON.stringify({ result: 'password', ...passwordFingerprint(secret) }));
      const captcha = await fetchLoginCaptcha();
      const path = join(dir, 'captcha.png');
      writeFileSync(path, Buffer.from(base64Payload(captcha.image), 'base64'));
      const recognition = recognizeCaptchaBase64(captcha.image);
      console.log(JSON.stringify({ result: 'ocr', path, ...recognition }));
      const state = await loginWithPassword({
        username: process.env.SCU_USERNAME ?? '',
        password: process.env.SCU_PASSWORD ?? '',
        captchaCode: captcha.code,
        captchaText: recognition.text,
      });
      console.log(JSON.stringify({ result: 'login', state, after: identityState() }));
    } else if (mode === 'interactive') {
      const captcha = await fetchLoginCaptcha();
      const path = join(dir, 'captcha.png');
      writeFileSync(path, Buffer.from(base64Payload(captcha.image), 'base64'));
      console.log(JSON.stringify({ result: 'captcha', code: captcha.code, path }));
      const text = await waitForAnswer(120_000);
      const state = await loginWithPassword({
        username: process.env.SCU_USERNAME ?? '',
        password: process.env.SCU_PASSWORD ?? '',
        captchaCode: captcha.code,
        captchaText: text,
      });
      console.log(JSON.stringify({ result: 'login', state, after: identityState() }));
    } else {
      const state = await loginWithPassword({
        username: process.env.SCU_USERNAME ?? '',
        password: process.env.SCU_PASSWORD ?? '',
        captchaCode: process.env.SCU_CAPTCHA_CODE ?? '',
        captchaText: process.env.SCU_CAPTCHA_TEXT ?? '',
      });
      console.log(JSON.stringify({ result: 'login', state, after: identityState() }));
    }
    app.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
  });
