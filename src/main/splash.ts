import { BrowserWindow, screen } from 'electron';

/**
 * 启动动画：无边框透明窗口 + 纯 CSS 动画（无脚本、无外部资源）。
 * 只负责「好看地遮住冷启动」，不参与业务；任何失败都静默降级为空操作。
 */
const splashHtml = (version: string) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<title>明远湖光</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  body {
    font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    color: #cfefff;
    display: grid;
    place-items: center;
  }
  .frame {
    position: relative;
    width: 100%; height: 100%;
    border-radius: 18px;
    overflow: hidden;
    background:
      radial-gradient(120% 90% at 15% 0%, rgba(0, 229, 255, .22), transparent 55%),
      radial-gradient(100% 80% at 100% 100%, rgba(120, 90, 255, .20), transparent 60%),
      linear-gradient(160deg, #04070f 0%, #060d1a 55%, #03060c 100%);
    border: 1px solid rgba(0, 229, 255, .35);
    box-shadow: 0 0 0 1px rgba(0, 229, 255, .08), 0 24px 60px rgba(0, 0, 0, .65), inset 0 0 60px rgba(0, 229, 255, .06);
  }
  .grid {
    position: absolute; inset: -40%;
    background-image:
      linear-gradient(rgba(0, 229, 255, .10) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0, 229, 255, .10) 1px, transparent 1px);
    background-size: 34px 34px;
    transform: perspective(420px) rotateX(58deg);
    animation: drift 9s linear infinite;
    opacity: .55;
  }
  @keyframes drift { from { background-position: 0 0; } to { background-position: 0 340px; } }
  .scan {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, transparent 0%, rgba(0, 229, 255, .16) 48%, transparent 52%);
    background-size: 100% 240%;
    animation: scan 2.6s ease-in-out infinite;
    mix-blend-mode: screen;
    pointer-events: none;
  }
  @keyframes scan { 0% { background-position: 0 -140%; } 100% { background-position: 0 140%; } }
  .content { position: relative; padding: 34px 38px 26px; display: grid; gap: 14px; }
  .eyebrow {
    font-size: 10px; letter-spacing: .42em; color: #5fd8ff; text-transform: uppercase;
    opacity: 0; animation: rise .5s ease-out .1s forwards;
  }
  h1 {
    margin: 0;
    font-size: 34px; font-weight: 700; letter-spacing: .30em;
    background: linear-gradient(92deg, #eafcff 0%, #6fe6ff 45%, #9d8bff 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 0 18px rgba(80, 210, 255, .35));
    opacity: 0; animation: rise .6s ease-out .2s forwards;
  }
  .sub { font-size: 11px; letter-spacing: .22em; color: #6f93ad; opacity: 0; animation: rise .6s ease-out .35s forwards; }
  .log { display: grid; gap: 4px; font-family: "Cascadia Code", Consolas, monospace; font-size: 11px; color: #6fd7ff; min-height: 52px; }
  .log span { opacity: 0; animation: rise .35s ease-out forwards; }
  .log span:nth-child(1) { animation-delay: .55s; }
  .log span:nth-child(2) { animation-delay: .95s; }
  .log span:nth-child(3) { animation-delay: 1.35s; }
  .log b { color: #4be3a5; font-weight: 600; }
  .bar { position: relative; height: 2px; background: rgba(0, 229, 255, .16); overflow: hidden; border-radius: 2px; }
  .bar::after {
    content: ""; position: absolute; inset-block: 0; width: 38%;
    background: linear-gradient(90deg, transparent, #6fe6ff, #a48bff, transparent);
    animation: sweep 1.15s ease-in-out infinite;
  }
  @keyframes sweep { 0% { transform: translateX(-110%); } 100% { transform: translateX(320%); } }
  .meta { display: flex; justify-content: space-between; font-size: 10px; letter-spacing: .16em; color: #4c6b80; }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .corner { position: absolute; width: 14px; height: 14px; border: 1px solid rgba(0, 229, 255, .55); }
  .corner.tl { top: 10px; left: 10px; border-right: 0; border-bottom: 0; }
  .corner.tr { top: 10px; right: 10px; border-left: 0; border-bottom: 0; }
  .corner.bl { bottom: 10px; left: 10px; border-right: 0; border-top: 0; }
  .corner.br { bottom: 10px; right: 10px; border-left: 0; border-top: 0; }
</style>
</head>
<body>
  <div class="frame">
    <div class="grid"></div>
    <div class="scan"></div>
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
    <div class="content">
      <p class="eyebrow">Sichuan University · Campus OS</p>
      <h1>明远湖光</h1>
      <p class="sub">MINGYUANHU WORKBENCH</p>
      <div class="log">
        <span>&gt; 挂载工作台核心… <b>OK</b></span>
        <span>&gt; 载入校园会话… <b>OK</b></span>
        <span>&gt; 建立本地通道… <b>READY</b></span>
      </div>
      <div class="bar"></div>
      <div class="meta"><span>BOOT SEQUENCE</span><span>v${version}</span></div>
    </div>
  </div>
</body>
</html>`;

const splashWidth = 460;
const splashHeight = 280;
/** 最短展示时长：加载太快时一闪而过反而像故障。 */
const minimumVisibleMs = 900;

export function openSplash(version: string): () => void {
  try {
    const { workArea } = screen.getPrimaryDisplay();
    const window = new BrowserWindow({
      width: splashWidth,
      height: splashHeight,
      x: Math.round(workArea.x + (workArea.width - splashWidth) / 2),
      y: Math.round(workArea.y + (workArea.height - splashHeight) / 2),
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      // 不抢焦点：用户可能在启动时已经切到别的窗口。
      focusable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    window.setMenuBarVisibility(false);
    let shownAt = 0;
    window.once('ready-to-show', () => {
      shownAt = Date.now();
      window.showInactive();
    });
    void window
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(version))}`)
      .catch(() => window.destroy());
    return () => {
      const delay = Math.max(0, minimumVisibleMs - (shownAt ? Date.now() - shownAt : 0));
      setTimeout(() => {
        if (!window.isDestroyed()) window.destroy();
      }, delay + 120);
    };
  } catch {
    return () => {};
  }
}
