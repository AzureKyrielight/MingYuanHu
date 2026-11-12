# 明远湖（MingYuanHu）改造说明

明远湖是从 [Dela](https://github.com/Chang-Yo/Dela) 复制的四川大学版本。上层工作台、Agent、项目/工作区、终端、笔记等能力保持不变；校园身份认证与校园业务改为调用四川大学各系统。

协议实现参考 [SCU-CLI](https://github.com/The-Brotherhood-of-SCU/SCU-CLI)（AGPL-3.0）。本仓库因此按 AGPL-3.0-or-later 分发。

## 通用能力增强（保留 Dela 能力并二次开发）

| 能力        | 变化                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| 全局搜索    | 支持空格分隔多关键词（AND）、标题命中排序（相等 > 前缀 > 词首 > 包含）、新增「本学期课程」来源（课程名/教师/教室均可搜） |
| 待办        | 新增重复规则（每天/每周/每月，完成后自动生成下一条）与到点提醒（提醒写入通知中心，同一待办只提醒一次）                   |
| 文档阅读    | 阅读位置持久化到本机（重启后回到上次位置）；PDF 新增目录（大纲）导航                                                     |
| 终端        | 新增快捷命令面板：保存常用命令，一键写入当前终端，可删除                                                                 |
| 备份 / 恢复 | 新增本机快照：手动/每天/每周自动备份到「文档/明远湖备份」，可保留 3/5/10 份，恢复在下次启动时生效                        |
| 联网        | 搜索免配置可用：未注册搜索服务时自动回退必应网页版；抓取纯前端渲染页面时补充正文与链接，并提示模型换来源                 |
| 模型        | 预设覆盖 DeepSeek / OpenAI / Claude / Gemini / Grok / 智谱 / 通义千问 / Kimi / MiniMax，选择器带厂商标记                 |
| 课表        | 学期下拉以「当前学期」为锚点：翻到往年也能一键切回本学期                                                                 |
| 体测        | 分项名称按川大接口字段译成中文（坐位体前屈、引体向上 / 仰卧起坐、50 米跑、耐力跑等），不再出现英文键名                   |
| 关于页      | 移除上游作者/贡献者/赞助者名单，改为本仓库作者 GitHub 与个人博客，以及上游 Dela 的许可证致谢                             |
| 应用内更新  | 「检查更新」发现新版本即自动下载，下载完只需「重新启动并安装」；发布流程会一并上传 `latest.yml`                          |

实现要点：

- 搜索排序与分词在 `src/main/search/rank.ts`，课表来源读 `timetable_lessons`（最近一次同步的学期）。
- 待办重复用自然日/周/月推进，跨月钳到目标月最后一天；提醒定时器每 30 秒检查一次（`src/main/index.ts`）。
- 阅读位置由 `src/renderer/content/preview/reading-position.ts` 维护，PDF 大纲在 `pdf-outline.ts`。
- 快捷命令存在 `workspace_settings`（键 `terminal-quick-commands`），见 `src/main/terminal/quick-commands.ts`。
- 快照用 `VACUUM INTO` 生成一致副本；恢复写标记文件，启动时在打开数据库前替换 `dela.db`（`src/main/backup.ts`）。

## 名称与启动方式

- 界面显示名为「明远湖光（MingYuanHu）」：侧边栏品牌、窗口标题、关于页、托盘与安装器名称都已改；
  数据目录仍是 `%APPDATA%\mingyuanhu`，改名不会丢数据。
- 启动动画：Electron 启动时显示无边框科幻风启动页（`src/main/splash.ts`），主窗口加载完成后自动收起；
  `--smoke-test`、`--hidden` 与开机自启不显示，`npm start`/打包版同样生效。
- 无控制台快捷启动：`scripts/launch-mingyuanhu.vbs` 用隐藏窗口拉起 `corepack pnpm dev` 并等待退出，
  因此不会再出现黑色命令行窗口，也不存在「关掉控制台把应用一起杀掉」的问题。
  运行一次 `powershell -ExecutionPolicy Bypass -File scripts/create-desktop-shortcut.ps1`
  会在桌面生成「明远湖光」快捷方式（图标取本机 Electron）。

## Windows 安装包（与 Dela 相同的封装方式）

上游 Dela 的安装包就是 electron-builder 的 NSIS 目标，本仓库沿用同一份 `electron-builder.yml`：

- `files` 只打包 `out/main`、`out/preload`、`out/renderer` 与 `package.json`，图标同时带上；
- `asar: true`，`better-sqlite3` / `node-pty` 通过 `asarUnpack` 解包；
- `electronLanguages` 只保留中英文，`win.target: nsis x64`，`nsis.include: build/installer.nsh`（安装向导文案）；
- `extraResources` 额外带上 MinGit、OpenSSH、`rg`/`fd` 与远端 helper；
- `publish` 指向本仓库的 GitHub Releases，`latest.yml` + `.blockmap` 供应用内更新使用。

构建入口：

```powershell
pnpm package:win      # 本机生成 dist/MingYuanHu-Setup-<版本>.exe
```

推 `v*` tag（或手动触发）会运行 `.github/workflows/windows-release.yml`：
在 `windows-2022` 上安装依赖 → `pnpm check` → `pnpm prepare:runtime` →
`electron-builder --win nsis --x64 --publish never`，再用 `gh release create/upload`
把安装包、`.blockmap` 与 `latest.yml` 一次性挂到 Release。
Dela 的 `release.yml` 也是先 `--publish never` 再用 `gh release create/upload`，效果一致。

> 为什么不直接用 `--publish always`：electron-builder 并行上传资产时可能在同一 tag 下
> 创建出两个 Release（一个只有 `.blockmap`），Releases 页面会看起来「没有 exe」。
> 交给 `gh` 单次发布可以避免这种竞态。

> 本机打包如果卡在 `downloading nsis-resources` / Unpacking Electron，是 electron-builder 的
> 缓存锁问题，与项目配置无关：可加 `-c.electronDist=node_modules/electron/dist` 复用已安装的
> Electron，并清理 `%LOCALAPPDATA%\electron-builder\Cache` 下的 `*.lock` 目录后重试；
> CI 上不会遇到。

## 排障笔记

- **教务处通知乱码**：`jwc.scu.edu.cn` 现在是 UTF-8（早前误按 GB18030 解码导致整页乱码）。
  `src/main/scu/notices.ts` 改为按 `Content-Type` / `<meta charset>` 解码，缺省 UTF-8，`gbk/gb2312` 走 gb18030。
- **川大邮箱登录失败**：学生邮局是 Coremail（IMAP/SMTP 走 `edu.icoremail.net`，直接用
  `mail.stu.scu.edu.cn` 会 TLS 主机名不匹配）。登录被拒时：
  1. 先在 `https://mail.stu.scu.edu.cn` 网页版激活邮箱并开启 IMAP/SMTP；
  2. 用邮箱设置里的「客户端专用密码」，网页登录密码通常不可用；
  3. 地址栏只填学号即可（会自动补 `@stu.scu.edu.cn`，漏写 `@` 也会自动修复）。
     主进程连接时带 `clientInfo`（Coremail 需要客户端 ID），错误文案已区分为登录被拒 / 网络不可达。

## 已接入的校园能力

| 能力                     | 数据源                                                  | 主进程模块                                          |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------- |
| 统一身份认证             | `id.scu.edu.cn`（登录窗手动完成，SM2/验证码由网页处理） | `src/main/campus.ts`                                |
| 课表 / 当前教学周 / 学期 | `zhjw.scu.edu.cn`（仅 HTTP）                            | `src/main/scu/zhjw.ts`、`src/main/timetable/api.ts` |
| 成绩（及格 / 方案）      | 教务综合查询                                            | `src/main/scu/zhjw.ts`                              |
| 考表                     | 教务考试管理                                            | `src/main/scu/zhjw.ts`                              |
| 用户基本信息             | `wfw.scu.edu.cn` 微服务                                 | `src/main/scu/wfw.ts`                               |
| 校园卡交易               | 微服务 `cardhis` 轻应用                                 | `src/main/scu/wfw.ts`                               |
| 宿舍电费                 | `payapp.scu.edu.cn` 缴费平台                            | `src/main/scu/payapp.ts`                            |
| 体测成绩 / 通知          | `pead.scu.edu.cn` 体测系统                              | `src/main/scu/fitness.ts`                           |
| 办事大厅我的申请         | `service.scu.edu.cn`                                    | `src/main/scu/service.ts`                           |

所有请求复用 Chromium 的校园会话分区 `persist:mingyuanhu-campus`，cookie 加密持久化；token、密码不进入 renderer，也不写入数据库。

## Agent 集成

`src/main/agent/domain/scu/index.ts` 提供以下命令，经本机 `dela` 命令桥调用：

- `scu_whoami`
- `scu_semesters`
- `scu_grades`
- `scu_exams`
- `scu_balance_campus` / `scu_balance_buildings` / `scu_balance_units` / `scu_balance`
- `scu_fitness`
- `scu_card_transactions`
- `scu_service_applications`

内置 Skill 位于 `src/main/agent/skills/scu/SKILL.md`，随应用写入 `~/.dela/skills/scu/`（沿用上游数据目录以兼容备份与设置）。

## 与上游 Dela 的差异

- 应用标识：`io.mingyuanhu.desktop`，产品名 `MingYuanHu`。
- 校园会话域：只持久化 `*.scu.edu.cn` cookie。
- 课表学期：使用川大 `planCode`（如 `2025-2026-2-1`），开学日期由用户在课表页手动设置。
- 导航：`课表`、`校园服务`、`邮箱`、`资料`。
- 首启向导：邮箱 → 教务 → 模型。
- 设置 › 连接：只展示邮箱与川大教务。
- 通知：只保留邮件与待办。
- 已移除的上游能力（代码一并删除）：Canvas 课程与资料、水源社区、课堂视频、交大教务处通知、交大培养方案。旧版本写入的数据库表与技能目录保留兼容读取，但不再注入或展示。
- 邮箱预设：学生 `@stu.scu.edu.cn` 的网页入口是 https://mail.stu.scu.edu.cn，但 IMAP/SMTP 必须连它的 CNAME 目标 `edu.icoremail.net`（993/465，SSL）——直接用 `mail.stu.scu.edu.cn` 会因证书只覆盖 `*.icoremail.net` 而 TLS 校验失败。教工 `@scu.edu.cn` 使用 `mail.scu.edu.cn`。学生邮箱需先激活；若开启二次验证，请使用客户端专用密码，而不是统一身份认证密码。
- 自动更新：发布源改为本仓库的 GitHub Releases（`AzureKyrielight/MingYuanHu`），不再指向上游 CDN；构建时生成 `latest.yml` 一并上传，应用内「检查更新」发现新版本会自动下载，下载完成后点「重新启动并安装」即可升级。

## 尚未接入

以下 SCU-CLI 能力尚未移植（协议实现见 `SCU-CLI/internal/api/`）：

| SCU-CLI 命令组                                  | 内容                                                                       | 状态                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------- |
| `ccyl`                                          | 第二课堂：活动列表、详情、报名/取消、预约/取消预约、学分、成绩单导出       | 未移植                                  |
| `cloudprint`                                    | 云打印：会话检查、任务列表已移植；上传（颜色/纸型/双面/份数/页范围）未移植 | 部分移植                                |
| `repair`                                        | 智慧后勤报修：地址、区域、项目、可预约日期/时段、提交、进度、撤回、评价    | 未移植                                  |
| `passpoint`                                     | 校园网无感认证：用户信息、设备列表、新增/取消 MAC 绑定                     | 未移植                                  |
| `service form` / `service submit`               | 办事大厅动态表单读取、提交、附件上传                                       | 未移植（`applications` 已移植）         |
| `zhjw calendar`                                 | 校历（免认证获取 + ICS 导出）                                              | 已移植                                  |
| `user labels` / `user devices` / `user offline` | 用户标签、校园网在线设备、强制下线                                         | 未移植（`user info`、校园卡交易已移植） |
| `--ics` 导出                                    | 课表 / 考表 / 校历导出为 ICS                                               | 已移植                                  |

已移植并有 UI：成绩、考表、电费（含趋势）、体测、校园卡交易、办事大厅我的申请、空闲教室、培养方案与学分完成、班级/课程课表、教务处通知、校历与 ICS 导出、云打印（只读）。

## 登录方式

- **网页登录**：`校园服务` 页右上角「连接统一认证」，在应用内完成统一认证并复用 Chromium 分区里的 `*.scu.edu.cn` cookie。
- **密码登录**：`校园服务` 页顶部「统一认证密码登录」输入学号 + 统一身份认证密码。
  - 密码经 SM2（C1C2C3，`04‖C1‖C2‖C3`）加密后提交，只在该次请求内使用，不落盘、不写日志、不交给模型。
  - 验证码由内置本地 OCR 识别（移植自 SCU-CLI / scu-plus 的质心模板），识别失败会换新验证码重试，不会用错误验证码打账号。
  - 失败文案 `login_failed_will_lock_<已尝试>_<上限>` 表示密码校验未通过；连续失败会临时锁定账号。
  - 注意：这里要的是**统一身份认证密码**（id.scu.edu.cn），不是教务系统密码。
- 电费余额趋势本地快照

需要时可在 `src/main/scu/` 下按现有模块风格扩展，并在 `src/main/scu/ipc.ts`、`src/preload/scu.ts`、`src/shared/scu.ts` 与 `src/main/agent/domain/scu/index.ts` 同步暴露。

## 开发

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

仓库的 `.npmrc` 关闭了 `engine-strict`：上游 `engines` 要求 Node ≥24.22.1，而本机可能是 24.14.x。实际运行与打包仍建议使用 `package.json` 指定的 Node 与 Electron 版本。

## 许可

- 上游 Dela：GPL-3.0-or-later。
- SCU-CLI 协议移植部分：AGPL-3.0。
- 本仓库整体按 **AGPL-3.0-or-later** 分发。若需要闭源分发，请先移除/重写来自 SCU-CLI 的协议实现并确认与上游 Dela 的许可兼容性。
