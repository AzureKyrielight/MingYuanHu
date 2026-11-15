// 本地开发用常驻监听：源文件停止改动后自动重新打包 NSIS 安装包，并把最新一份复制到桌面，
// 省去每次从 GitHub Releases 下载的时间。MinGit 等运行时已有 .build 缓存，不会重复下载。
// 用法：corepack pnpm dev:installer（Ctrl+C 退出）
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = readFileSync(join(root, '.node-version'), 'utf8').trim();
const debounce = Number(process.env.INSTALLER_DEBOUNCE_MS ?? 30_000);
const watchDirectories = ['src', 'scripts', 'build', 'assets'];
const installerName = /^MingYuanHu-Setup-.*\.exe$/i;
const desktopName = 'MingYuanHu-最新.exe';

function meets(node: string, minimum: string): boolean {
  const a = node.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

if (!meets(process.versions.node, required)) {
  console.error(
    `需要 Node ${required}，当前是 ${process.versions.node}。\n` +
      '先执行 . ./scripts/use-local-tools.ps1，或把对应版本的 node 放到 PATH 前面再运行。',
  );
  process.exit(1);
}

function installerPath(): string | null {
  const directory = join(root, 'dist');
  if (!existsSync(directory)) return null;
  const files = readdirSync(directory)
    .filter((name) => installerName.test(name))
    .map((name) => join(directory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return files[0] ?? null;
}

function build(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('corepack pnpm --config.verify-deps-before-run=false package:win', {
      cwd: root,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function copyToDesktop(file: string): void {
  const desktop = [join(homedir(), 'OneDrive', 'Desktop'), join(homedir(), 'Desktop')].find(
    (directory) => existsSync(directory),
  );
  if (!desktop) {
    console.warn('[installer] 找不到桌面目录，跳过复制');
    return;
  }
  const target = join(desktop, desktopName);
  try {
    copyFileSync(file, target);
    console.log(`[installer] 已复制到桌面：${target}`);
  } catch (error) {
    console.warn(`[installer] 复制到桌面失败：${error instanceof Error ? error.message : error}`);
  }
}

let timer: NodeJS.Timeout | undefined;
let running = false;
let pending = false;

async function rebuild(): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const startedAt = Date.now();
  console.log(`[installer] 开始打包（${new Date().toLocaleTimeString()}）`);
  const code = await build();
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  running = false;
  if (code === 0) {
    const file = installerPath();
    if (file) {
      console.log(`[installer] 打包完成，用时 ${seconds} 秒：${file}`);
      copyToDesktop(file);
    }
  } else {
    console.error(`[installer] 打包失败（exit ${code}），修好后保存文件即可重试`);
  }
  if (pending) {
    pending = false;
    console.log('[installer] 打包期间又有改动，稍后再打一次');
    schedule();
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void rebuild();
  }, debounce);
}

const isNoise = (name: string | null) =>
  !name || /(^|[\\/])\.(DS_Store|git)$|\.(swp|tmp|log)$|~$/.test(name);

for (const name of watchDirectories) {
  const directory = join(root, name);
  if (!existsSync(directory)) continue;
  watch(directory, { recursive: true }, (_event, filename) => {
    if (!isNoise(filename)) schedule();
  });
}

watch(root, (_event, filename) => {
  if (isNoise(filename)) return;
  const name = String(filename);
  if (name.includes('/') || name.includes('\\')) return;
  if (
    name === 'package.json' ||
    name === '.node-version' ||
    /^(electron-builder\.ya?ml|tsconfig(\..+)?\.json|vite\..+\.config\.[cm]?[jt]s)$/.test(name)
  )
    schedule();
});

const current = installerPath();
console.log(
  `[installer] 监听 ${watchDirectories.join('、')} 与构建配置；停止改动 ${debounce / 1000} 秒后打包`,
);
if (current) console.log(`[installer] 当前安装包：${current}`);
else console.log('[installer] 还没有安装包，先打一次');
if (!current) void rebuild();

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (timer) clearTimeout(timer);
    console.log('\n[installer] 已退出监听');
    process.exit(0);
  });
