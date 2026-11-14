---
name: scu-campus
description: 四川大学校园服务：教务、课表、电费、体测、校园卡、第二课堂、办事大厅、报修与无感认证
---

# 川大校园服务

通过 shell 的 `dela` 命令桥调用，输出 JSON；不需要将校园命令注册为常驻工具。

## 按需发现

1. 不确定命令时，先取校园命令摘要：`dela help '{"domain":"scu","summary":true}'`。
2. 只取目标命令的参数：`dela help '{"command":"scu_grades"}'`。
3. 调用命令，例如 `dela scu_grades` 或 `dela scu_grades '{"scheme":true}'`。

参数错误按返回的 `parameters` / `issues` 修正，不要重复发送相同输入。默认 `dela help` 保留完整命令 schema，仅在确实需要全量信息时使用。

## 边界

- 保研/推免、校企合作、就业公告等属于公开政策检索，不是个人校园 API 查询；先明确年份与学院，按查询参考检索官方公告及正文附件。
- 认证错误（`code:AUTH_EXPIRED`、`retryable:false`）后停止重试，提示用户在「校园服务」页重新连接统一身份认证；不要索要密码、验证码或 token。公开教务通知免登录。
- 只读查询可直接调用。报名、取消、提交、绑定/解绑等写操作会真实生效，必须先向用户说明并确认；不要自动重试写操作。
- 编号从 index/options/搜索结果逐级获取，不要猜。成绩、考表等原始业务 JSON 不应盲目截断或把一次返回的字段当成稳定契约。
- 列表命令支持哪些分页参数，以目标 schema 为准；不要给所有命令强加 offset/limit。

按任务读取 [查询流程与编号](references/queries.md) 或 [写操作前置条件](references/actions.md)，不必一次读取全部参考。
