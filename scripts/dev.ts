import { spawn, type ChildProcess } from 'node:child_process';
import { build, createServer, type Rolldown, type ViteDevServer } from 'vite';
import electronApi from 'electron';

// 从 node 进程 require('electron') 得到的是可执行文件路径字符串，不是 API 命名空间。
const electron = electronApi as unknown as string;

let child: ChildProcess | undefined;
let server: ViteDevServer | undefined;
const watchers: Rolldown.RolldownWatcher[] = [];
let stopping = false;
let restarting: ReturnType<typeof setTimeout> | undefined;
let initialized = false;

async function stopChild() {
  if (!child || child.exitCode !== null) return;
  const previous = child;
  child = undefined;
  await new Promise((resolve) => {
    previous.once('exit', resolve);
    previous.kill();
  });
}

async function restart() {
  clearTimeout(restarting);
  restarting = setTimeout(async () => {
    await stopChild();
    if (stopping) return;
    const current = spawn(
      electron,
      [
        // 本机沙箱/权限组合下 Electron 可能以 STATUS_BREAKPOINT 静默退出，禁用沙箱是开发默认。
        '--no-sandbox',
        '.',
        ...(process.argv.includes('--smoke-test') ? ['--smoke-test'] : []),
      ],
      {
        stdio: 'inherit',
        // DSH/自动化环境会注入 ELECTRON_RUN_AS_NODE=1；原样继承会让 Electron 按 Node 运行
        // （主进程报 “Cannot read properties of undefined (reading 'requestSingleInstanceLock')”），
        // 所以显式 delete 该变量，而不是设为空串（空串仍会被 Electron 当真值）。
        env: (() => {
          const next = { ...process.env } as Record<string, string | undefined>;
          delete next.ELECTRON_RUN_AS_NODE;
          next.DELA_DEV_URL = 'http://127.0.0.1:5173';
          return next;
        })(),
      },
    );
    child = current;
    current.once('exit', (code) => {
      if (child === current) void shutdown(code ?? 1);
    });
    current.once('error', (error) => {
      console.error(error);
      void shutdown(1);
    });
  }, 150);
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restarting);
  await stopChild();
  await Promise.all(watchers.map((watcher) => watcher.close()));
  await server?.close();
  process.exitCode = code;
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  server = await createServer({ configFile: 'vite.renderer.config.ts', mode: 'development' });
  await server.listen();
  for (const configFile of ['vite.main.config.ts', 'vite.preload.config.ts']) {
    // build.watch 模式的返回值是 watcher，静态类型上是三态联合，这里断言成 watcher。
    const watcher = (await build({
      configFile,
      mode: 'development',
      build: { watch: {} },
    })) as Rolldown.RolldownWatcher;
    watchers.push(watcher);
    await new Promise((resolve, reject) => {
      const ready = (event: Rolldown.RolldownWatcherEvent) => {
        if (event.code === 'ERROR') reject(event.error);
        if (event.code === 'END') {
          watcher.off('event', ready);
          resolve(undefined);
        }
      };
      watcher.on('event', ready);
    });
    watcher.on('event', (event) => {
      if (event.code === 'END' && initialized) void restart();
      if (event.code === 'ERROR') console.error(event.error);
    });
  }
  initialized = true;
  await restart();
} catch (error) {
  console.error(error);
  await shutdown(1);
}
