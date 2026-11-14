<div align="center">

<picture>
  <img src="assets/Dela_white_bg.png" alt="明远湖光" width="160">
</picture>

</div>

---

<div align="center">

**明远湖光（MingYuanHu）· An Agent Harness for SCUers**

_继承自 [Dela](https://github.com/Chang-Yo/Dela)，校园接口移植自 [SCU-CLI](https://github.com/The-Brotherhood-of-SCU/SCU-CLI)。_

</div>

---

> [!NOTE]
> **项目来源**
>
> | 来源                                                         | 提供了什么                                                                                                       |
> | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
> | [Dela](https://github.com/Chang-Yo/Dela)                     | 整个产品骨架：Electron 工作台、基于 Pi 的 Agent、终端、项目/会话、笔记、邮件、课表、TODO、搜索等                 |
> | [SCU-CLI](https://github.com/The-Brotherhood-of-SCU/SCU-CLI) | 四川大学校园协议实现：统一身份认证、教务、微服务、电费、体测、办事大厅、云打印、校历与通知等                     |
> | 明远湖光（本仓库）                                           | 把上述校园协议接入 Dela 的界面与 Agent，替换交大专属能力，补上「明远湖光」品牌、Windows 安装包与若干通用能力增强 |
>
> 协议实现参考 SCU-CLI（AGPL-3.0），因此本仓库整体按 **AGPL-3.0-or-later** 分发；上游 Dela 的 GPL-3.0 文本保留在 [LICENSE](LICENSE)。

> [!IMPORTANT]
> 下载、安装或使用本软件，即视为你已阅读并同意本项目的[使用条款](docs/terms.md)与[隐私条款](docs/privacy.md)。
> 如果你不同意其中部分内容，可以跳过对应服务的配置、不提供该项凭据，从而仅使用其余功能；如果你不同意全部条款，请停止使用并卸载本软件。

明远湖光是面向四川大学学生的 Agent 产品：内核沿用 Dela 的 Pi Agent 与本地优先工作台，
校园服务全部改走川大公开接口（id.scu.edu.cn 统一认证、教务系统、微服务、缴费平台、体测、办事大厅等）。
凭据经系统钥匙串（Windows DPAPI / macOS Keychain）加密后保存在本机用户数据目录，其余数据保存在本地，不上传服务器。

## 功能概览

**水源社区、课堂视频下载等交大专属试验功能已移除；所有侧栏功能入口可在 “设置 › 通用 › 导航入口” 中隐藏。**

### 校园信息服务（四川大学）

- **统一身份认证**：应用内完成登录，cookie 复用 Chromium 加密分区；支持学号 + 密码（SM2 加密、验证码本地 OCR）
- **课表与日历**：教务课表同步、当前教学周自动推导、江安/望江/华西作息时间，月视图支持滑拽创建事件，与 TODO 双向互通
- **成绩 / 考表 / 培养方案**：成绩汇总、考试安排、培养方案与学分完成度
- **生活服务**：宿舍电费余额与趋势、体测成绩与通知、校园卡交易
- **办事大厅**：我的申请进度；**空闲教室**查询（按周次/时段/校区）
- **课表查询**：按班级、按课程查询课表
- **教务处通知**：公告列表与正文（自动识别 UTF-8/GBK 编码）
- **校历与导出**：川大校历获取、导入本地日历、课表/考表/校历导出 ICS
- **云打印（只读）**：检查会话与打印任务列表（上传功能未接入）
- **校园邮箱**：川大邮箱（学生 Coremail / 教工）与任意第三方 IMAP/SMTP，本地保存草稿
- **全局搜索**：跨项目、会话、邮件、课程资料、课表课程与设置；支持空格分隔多关键词
- **TODO**：重复规则（每天/每周/每月）、到点提醒、写入课表日历

### Agent 功能

Dela Harness 基于 Pi 构建，可作为通用 Agent 使用，并针对 Coding 场景加强。

- **第三方接入**：导入第三方 skills、接入 MCP 服务器、兼容大部分 Pi Packages 生态（扩展、skills、提示模板；来源支持 npm、git 与本地目录）；扩展与明远湖光同权限运行，安装前请确认来源可信
- **内置校园 skills**：Agent 可直接查询成绩、课表、考试、电费、体测、校园卡、空闲教室、培养方案、教务通知、云打印任务等
- **课程论文排版**：按学校格式（封面、摘要、正文层级、参考文献）把结构化草稿渲染成 DOCX；封面姓名、学号等取自本机缓存的个人资料，不经过模型上下文
- **联网**：自定义 `web_search`（需自备 API Key，默认关闭）与免费的 `web_fetch`（默认开启）
- **上下文**：`@` 引用项目文件、`#` 引用同项目会话；支持附件、选中回复评论、旁问、从任意回复分出新会话
- **Agent 编排**：主 Agent 可派出上下文独立的子 Agent；子会话可只读查看，可在「设置 › 内置能力」关闭
- **异步执行**：长命令与子 Agent 可后台运行，结束后自动回到会话
- **Remote project**：把远端目录登记为项目，经 SSH 上传 helper 维持通道，Agent 直接在服务器上执行
- **会话导出**：当前分支导出 ZIP（聊天记录、图片、附件、引用与评论）

### 工作台功能

- **Markdown 笔记**：即时渲染，支持数学公式与 mermaid
- **文件编辑**：按内容识别文本文件，1 MB 以上只读预览
- **内置终端**：本地 Git Bash，remote project 默认 ssh；新增「快捷命令」面板

### 明远湖光专属增强

- **启动动画**：启动时显示无边框科幻风动画（`src/main/splash.ts`），加载完成自动收起
- **无控制台启动**：`scripts/launch-mingyuanhu.vbs` + 桌面快捷方式，双击即可静默启动
- **本机备份 / 恢复**：手动或每天/每周快照到「文档/明远湖备份」，可回滚到任意一份
- **PDF 阅读增强**：阅读位置持久化、目录（大纲）导航

## 技术栈

![Electron](https://img.shields.io/badge/Electron-v44-47848F?style=for-the-badge&logo=electron&logoColor=white&labelColor=1F2328)
![React](https://img.shields.io/badge/React-v19-087EA4?style=for-the-badge&logo=react&logoColor=white&labelColor=1F2328)
![TypeScript](https://img.shields.io/badge/TypeScript-v7-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=1F2328)
![Vite](https://img.shields.io/badge/Vite-v8-646CFF?style=for-the-badge&logo=vite&logoColor=white&labelColor=1F2328)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white&labelColor=1F2328)
![Pi](https://img.shields.io/badge/Pi-v1.1-1E293B?style=for-the-badge&logoColor=white&labelColor=1F2328)
![Go](https://img.shields.io/badge/Go-v1.22-00ADD8?style=for-the-badge&logo=go&logoColor=white&labelColor=1F2328)

## 下载安装（Windows 10 / 11）

1. 打开 [Releases](https://github.com/AzureKyrielight/MingYuanHu/releases/latest) 下载最新的
   `MingYuanHu-Setup-<版本>.exe`（Windows 10/11 x64，NSIS 安装包）。
2. 双击安装：可选择安装目录，安装完成后自动创建桌面与开始菜单快捷方式「明远湖光」。
3. 已安装版本会在后台检查 GitHub Releases 并在应用内提示更新，无需手动重装。

> 安装包不包含任何凭据；登录信息只在本机首次配置时写入系统加密存储。

## 本地开发

从 `dev` 创建功能分支，贡献 PR 统一提交到 `dev`；只有仓库管理员可以发起 `dev` → `main` 的 PR。详见 [贡献指南](CONTRIBUTING.md#分支与合并流程)。

推荐使用 [`.node-version`](.node-version) 指定的 Node.js 与 [`package.json`](package.json) 的 `packageManager` 指定的 pnpm，兼容范围见 `engines`（本机可用 `. ./scripts/use-local-tools.ps1` 启用仓库内固定版本）：

```sh
pnpm install
pnpm dev
```

### 无控制台启动（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File scripts/create-desktop-shortcut.ps1
```

脚本在桌面生成「明远湖光」快捷方式：通过 `wscript` 隐藏控制台拉起 `pnpm dev`，
启动时显示科幻风启动动画，关闭应用后进程自动结束。

| 命令                | 用途                                                  |
| ------------------- | ----------------------------------------------------- |
| `pnpm dev`          | 启动开发服务器和窗口，监听主进程/preload 变更         |
| `pnpm build`        | 类型检查与 main/preload/renderer 三入口生产构建       |
| `pnpm test`         | Vitest 单元测试                                       |
| `pnpm smoke`        | Electron 内 SQLite、React 渲染与 preload 隔离冒烟检查 |
| `pnpm package:win`  | 生成 Windows 10/11 x64 的 NSIS 安装包（`dist/`）      |
| `pnpm package:dist` | 生成当前平台的安装包                                  |

环境搭建细节、冒烟测试与代码组织约定见 [开发文档](docs/DEVELOPMENT.md)；版本与发布流程同样在其中。

## 文档

| 文档                                   | 内容                                           | 读者           |
| -------------------------------------- | ---------------------------------------------- | -------------- |
| [开发文档](docs/DEVELOPMENT.md)        | 架构、各子系统约定、构建与发布流程             | 贡献者（先读） |
| [明远湖光改造说明](docs/mingyuanhu.md) | 校园接口移植矩阵、登录方式、通用能力增强与排障 | 使用者、贡献者 |
| [使用条款](docs/terms.md)              | 软件性质、责任划分与免责范围                   | 使用者         |
| [隐私条款](docs/privacy.md)            | 数据存放位置与联网去向                         | 使用者         |
| [更新日志](CHANGELOG.md)               | 按版本分节的变更记录                           | 贡献者         |
| [贡献指南](CONTRIBUTING.md)            | 环境准备、提交规范与协作方式                   | 贡献者         |
| [功能边界](docs/what-we-not-do.md)     | 明确不做与需先讨论的功能                       | 贡献者         |
| [安全策略](SECURITY.md)                | 漏洞报告渠道、支持范围与安全边界               | 使用者、贡献者 |
| [校园接口资料](docs/sjtu-apis.md)      | Canvas 实测数据结构与交大接口索引              | 贡献者         |

## 贡献者

![Contributors](https://contrib.rocks/image?repo=Chang-Yo/Dela 'Contributors')

## 许可

本项目基于 Dela（GPL-3.0-or-later）改造，校园协议部分参考 SCU-CLI（AGPL-3.0），整体以 **GNU Affero General Public License v3.0（AGPL-3.0-or-later）** 发布，全文见 [LICENSE-AGPL-3.0.txt](LICENSE-AGPL-3.0.txt)；上游 Dela 的 GPL-3.0 文本保留在 [LICENSE](LICENSE)。代码与素材版权归原作者所有。

## 赞助鸣谢

您可以前往 “设置 > 关于” 页面为作者提供赞助 🙏

<table>
  <tr>
    <td width="80" align="center" valign="middle">
      <img src="assets/sponsors/FRAMENEO_logo_black.png" width="44" alt="FRAMENEO logo">
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/"><strong>FRAMENEO</strong></a><br>
      为 Dela 的软件包分发提供免费的高速 CDN 服务。
    </td>
    <td valign="middle">
      <a href="https://www.frameneo.com/">FRAMENEO Website</a>
    </td>
  </tr>
</table>
