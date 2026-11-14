import { chmod, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const nodePtyPackage = path.dirname(require.resolve('node-pty/package.json'));

  // node-pty 1.1.0 的 Darwin spawn-helper 随 npm 包落盘为 0644，启动 PTY 前必须可执行。
  for (const arch of ['arm64', 'x64']) {
    await chmod(path.join(nodePtyPackage, 'prebuilds', `darwin-${arch}`, 'spawn-helper'), 0o755);
  }

  // 在 Windows（core.filemode=false）提交时，随包 rg/fd 会被记成 0644；测试与应用都靠 PATH 找到它们。
  const tools = path.resolve('vendor', 'bin', `darwin-${process.arch}`);
  for (const name of await readdir(tools).catch(() => [])) {
    await chmod(path.join(tools, name), 0o755);
  }
}
