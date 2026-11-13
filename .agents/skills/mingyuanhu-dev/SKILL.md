---
name: mingyuanhu-dev
description: 明远湖光（MingYuanHu）的日常开发、优化与 debug 手册。在修改或排障本仓库的代码、构建/打包/发版、调试 Electron 主进程或渲染层、排查四川大学校园接口（统一认证 / 教务 / 办事大厅 / 第二课堂 / 报修 / 无感认证 / 云打印）时使用；也适用于“这个报错是校园网挂了还是我们的 bug”“怎么本地验证”“怎么发版”这类问题。
version: 1.0.0
author: AzureKyrielight
tags:
  - mingyuanhu
  - electron
  - debug
  - release
  - scu
---

# 明远湖光开发手册

先 `query_memory` 查 `decision` / `lesson`（关键词：传输层、UA、教务、订阅、flaky），再读本文件；
本文件只写“看完就要动手”的部分，背景推导见项目记忆。

## 1. 环境与命令

```powershell
Set-Location 'C:\Users\ryuum\Desktop\MingYuan\MingYuanHu'
node -v                      # 必须 24.22.1+；低于会触发 pnpm ERR_PNPM_UNSUPPORTED_ENGINE
corepack pnpm install --frozen-lockfile --config.engine-strict=false
```

- 包管理器一律 `corepack pnpm`（pnpm 不在 PATH）。
- **Node 版本漂移**：PATH 里的 node 可能被换成 24.14.x。此时 pnpm 会拒绝安装，改用
  `C:\Users\ryuum\node\node-v24.22.1-win-x64\node.exe node_modules\prettier\bin\prettier.cjs …`
  直接跑工具，或把该 node 放到 PATH 前面。
- **Electron 在本机必须 `--no-sandbox`**，否则 `STATUS_BREAKPOINT 0x80000003` 静默退出。
- 若 Electron 报 `bad option: --no-sandbox`，是环境里带了 `ELECTRON_RUN_AS_NODE=1`，spawn 前删掉该变量。
- **github.com 的 IPv6 常不通**：`git push` 报 `Connection reset` 时用
  `git -c http.curloptResolve=github.com:443:140.82.114.4 push origin main`；
  校验网页用 `curl.exe --resolve github.com:443:140.82.114.4 …`，或直接查 API（IPv4 正常）。

## 2. 改完必跑的门禁

```powershell
corepack pnpm exec tsc -p tsconfig.main.json --noEmit
corepack pnpm exec tsc -p tsconfig.preload.json --noEmit
corepack pnpm exec tsc -p tsconfig.renderer.json --noEmit
corepack pnpm exec tsc -p tsconfig.scripts.json --noEmit
corepack pnpm exec prettier --check .
corepack pnpm exec oxlint --deny-warnings src scripts
corepack pnpm exec vitest run --maxWorkers=4
```

`pnpm typecheck` 会吞掉失败退出码，PowerShell 下逐个看 `$LASTEXITCODE`。

已知 flaky（与业务无关，单独重跑即过；CI 偶发红也是它们）：
`src/main/agent/test/session.test.ts`、`src/renderer/workbench/test/workbench-explorer.test.tsx`、
`src/main/remotes/test/background-tasks.test.ts`。

## 3. 调试主进程 / 校园接口

**不要靠猜，写临时探针。** 探针放在 `.tools/`（已在 `.gitignore`）：
一个 `.tools/xxx-probe.ts` + 一个 `.tools/run-xxx-probe.ts`（vite 打包成 cjs 后用 electron 跑）。
探针必须做到：

- `app.setPath('userData', join(process.env.APPDATA, 'mingyuanhu'))` 复用真实分区与会话；
- `app.on('window-all-closed', () => {})`，否则隐藏窗口一关进程就退出；
- 凭据只从 `SCU_USERNAME` / `SCU_PASSWORD` 环境变量读，绝不写进文件；
- 带 `SCU_DEBUG=1` 跑，逐跳日志（`[scu:http] redirect …`）能直接定位停在哪一跳；
- **跑完删除探针与日志**：探针输出里可能含学号、姓名、手机、MAC，不能留在仓库或 `.tools`。

子系统报错的判断顺序：

1. `final=` 停在 `id.scu.edu.cn/login` → 统一认证会话/UA 问题，不是网络；
2. `final=` 停在业务站的登录页 → 该子系统 cookie 没建立（看是否走了对应的 SSO 中继）；
3. 200 但“无法识别的数据” → 解析到了登录页/HTML，回到 1、2；
4. 连接超时 → 先确认协议（教务是 **纯 HTTP**，用 https 探测必然超时）。

## 4. 代码地图

| 位置                                                                                 | 职责                                                                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/main/scu/client.ts`                                                             | 校园请求传输层：Node http/https 逐跳跟随 + 自持 cookie jar + UA；**不要换回 Electron fetch/net.request** |
| `src/main/scu/cookie-jar.ts`                                                         | RFC6265 匹配/过期，纯函数，有单测                                                                        |
| `src/main/scu/identity.ts`                                                           | 统一认证密码登录、token 持久化、`session/save`、827 处理                                                 |
| `src/main/campus.ts`                                                                 | 校园分区、`CAMPUS_USER_AGENT`、登录窗、cookie 快照                                                       |
| `src/main/scu/{service,ccyl,repair,passpoint,cloudprint,zhjw,wfw,payapp,fitness}.ts` | 各子系统                                                                                                 |
| `src/main/scu/ipc.ts` + `src/preload/scu.ts` + `src/shared/scu.ts`                   | IPC 契约：加接口要三处同步                                                                               |
| `src/renderer/features/campus/*`                                                     | 校园服务界面（`CampusServicesView`、`campus-extra-panels`、`CampusLoginDialog`）                         |

## 5. 校园协议要点（改接口前必读）

- **UA 必须固定为 `CAMPUS_USER_AGENT`**：统一认证按 UA 绑定 token/会话，不一致返回
  `{"code":"827","message":"Invalid token, browser mismatch"}`；Electron 默认 UA 含版本号，升级即失效。
- 传输层用 `scuRequest`；需要「最终回跳地址里的参数」（`sp_logged` 的 code、`jwt31` 的 userinfo、
  云打印的 code/fee）时它已经返回正确 `url`（Electron `fetch` 的 `Response.url` 恒空）。
- **教务（zhjw）**：纯 HTTP；密码登录不会自动有教务会话，`bindZhjwSession()` 用 Bearer 走
  `scdxplugin_jwt23` 中继建立，`fetchGrades/fetchSchedule/...` 内已自动调用。
- **无感认证（passpoint）**：业务接口只认浏览器导航建立的会话，靠隐藏 `BrowserWindow` 预热
  - `publishScuCookies/absorbScuCookies` 双向同步；UA 也要一致。
- **第二课堂**：搜索结果行是活动库（`activityLibraryId`），报名要场次 `activityId`；
  `activities` 为空的活动库（如「好消息盲盒」）报名 = **订阅**（`subscribe-act` / `cancel-subscribe`）。
- **报修**：项目树字段是 `label`；工单 id 用列表行的 `activeId`，否则报「不允许撤回」。
- **办事大厅**：动态表单需要事项 ID（`appId`，来自事项页地址栏），服务端没有事项列表接口。
- **电费**：缴费平台按学号校验，只能查本人账号绑定的房间，查别人寝室被拒是正常的。

## 6. 发布

```powershell
corepack pnpm version:patch                     # 或 manual 改 package.json
# 手写 CHANGELOG.md 的 `## <版本> - <日期>`，条目面向用户、动词开头
corepack pnpm exec prettier --write CHANGELOG.md
git add -A; git commit -m "chore(release): x.y.z"
git tag -a vx.y.z -m "vx.y.z"
git push origin main; git push origin vx.y.z    # 推 tag 触发 windows-release.yml
```

- 只发 `v*` tag 就够了：CI 跑 `pnpm check` → 打 NSIS → `gh release create/upload` 上传
  `MingYuanHu-Setup-<ver>.exe`、`.blockmap`、`latest.yml`（自动更新 feed）。
- 校验成功（不依赖 gh）：
  `curl.exe -4 -sS -H 'User-Agent: dsh' https://api.github.com/repos/AzureKyrielight/MingYuanHu/releases/tags/vX.Y.Z`
  看 `assets`；或 `releases/expanded_assets/vX.Y.Z` 页面。
- CI 因 flaky 测试失败时：删 tag 再推同一个 tag 重跑（`git push origin :refs/tags/vX.Y.Z` 后重推），
  不要为了过 CI 改业务代码。

## 7. 硬规则

- 含中文的文件只用编辑工具改；**绝不**用 PowerShell `Get-Content/Set-Content`（会按 ANSI 写坏）。
- 不提交诊断探针、运行日志、凭据；`.tools/`、`HANDOFF.md` 已在 `.gitignore`。
- 提交按主题拆分；CHANGELOG 只写用户可见变化，不抄 commit 列表。
- 只读冒烟可以随意跑；写操作（报名、报修、绑定设备、打印）先确认，能撤销的才做。
- 界面改动走 `frontend-design` skill；React 细节走 `react-dev` / `react-useeffect`。
