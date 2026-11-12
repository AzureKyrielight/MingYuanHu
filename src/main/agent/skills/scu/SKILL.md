---
name: scu-campus
description: 四川大学校园服务：教务成绩/考表/学期、宿舍电费、体测、校园卡交易与办事大厅申请
---

# 川大校园服务

所有命令经本机 `dela` 命令桥调用，输出 JSON。需要用户先在「校园服务」页完成一次四川大学统一身份认证；会话失效时提示用户重新连接，不要索要密码或验证码。

## 可用命令

| 命令                                                                                   | 用途                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `dela scu_whoami`                                                                      | 当前账号姓名、学号、院系等基本信息                     |
| `dela scu_semesters`                                                                   | 学期列表；`value` 为 planCode（如 `2025-2026-2-1`）    |
| `dela scu_grades` / `dela scu_grades '{"scheme":true}'`                                | 及格成绩 / 方案成绩（教务原始 JSON）                   |
| `dela scu_exams`                                                                       | 考表：课程、周次、日期、时段、地点、座位号             |
| `dela scu_balance '{"type":1}'`                                                        | 照明电费；`type:2` 为空调电费                          |
| `dela scu_balance_trend '{"type":1,"days":30}'`                                        | 余额趋势（本地快照，按北京日聚合；`days` 默认 0=全部） |
| `dela scu_balance_campus`                                                              | 电费校区列表（`code` = schoolCode）                    |
| `dela scu_balance_buildings '{"schoolCode":"1"}'`                                      | 楼栋列表（`code` = regCode）                           |
| `dela scu_balance_units '{"schoolCode":"1","regCode":"101"}'`                          | 单元列表（`code` = unitCode）                          |
| `dela scu_fitness '{"kind":"score","year":2026}'`                                      | 体测成绩；`kind:"notices"` 为通知                      |
| `dela scu_card_transactions '{"sdate":"2026-09-01","edate":"2026-09-30"}'`             | 校园卡交易；日期可省略                                 |
| `dela scu_service_applications '{"status":1}'`                                         | 办事大厅我的申请；0 全部、1 进行中、3 已完成           |
| `dela scu_cloudprint_check`                                                            | 云打印会话是否可用（只读，不产生任务）                 |
| `dela scu_cloudprint_jobs`                                                             | 云打印任务列表（只读；不含账号/卡号/姓名）             |
| `dela scu_jwc_notices '{"page":1}'`                                                    | 教务处通知列表（公开页面，免登录；`page` 从 1 开始）   |
| `dela scu_jwc_notice '{"url":"https://jwc.scu.edu.cn/info/..."}'`                      | 教务处通知详情（标题、发布时间、正文）                 |
| `dela scu_classroom_index`                                                             | 空闲教室：校区与教学楼编号                             |
| `dela scu_classroom_types '{"campusNumber":"1","buildingNumber":"101"}'`               | 空闲教室：教室类型                                     |
| `dela scu_classroom '{"campusNumber":"1","buildingNumber":"101","date":"2026-09-20"}'` | 教室占用情况                                           |
| `dela scu_program_colleges` / `dela scu_program_grades`                                | 培养方案：学院 / 年级选项                              |
| `dela scu_program_search '{"college":"304"}'`                                          | 搜索培养方案（含方案号 fajhh）                         |
| `dela scu_program_detail '{"fajhh":"10692"}'`                                          | 培养方案详情（treeList 含 urlPath）                    |
| `dela scu_program_course '{"urlPath":"/student/..."}'`                                 | 培养方案中的课程详情                                   |
| `dela scu_plan_completion`                                                             | 培养方案学分完成情况（zNodes）                         |
| `dela scu_class_options`                                                               | 班级课表：学期/年级/院系选项                           |
| `dela scu_class_subjects '{"departmentNum":"304"}'`                                    | 班级课表：专业列表                                     |
| `dela scu_class_list '{"plan":"2026-2027-1-1","subject":"..."}'`                       | 搜索班级（含 planCode/classCode）                      |
| `dela scu_class_schedule '{"planCode":"...","classCode":"..."}'`                       | 班级课表                                               |
| `dela scu_course_options`                                                              | 课程课表：学期/院系/课程类别选项                       |
| `dela scu_course_search '{"name":"计算机"}'`                                           | 搜索课程（含 ZXJXJHH/KCH/KXH）                         |
| `dela scu_course_schedule '{"planCode":"...","courseCode":"...","courseSeq":"..."}'`   | 课程（教学班）排课                                     |
| `dela scu_service_form '{"appId":"1234"}'`                                             | 办事大厅事项的动态表单定义（字段 key/类型/选项/必填）  |
| `dela scu_service_submit '{"appId":"1234","values":{...}}'`                            | 提交办事大厅事项（写操作；values 用表单字段 key）      |
| `dela scu_ccyl_activities '{"name":"志愿"}'`                                           | 搜索第二课堂活动库                                     |
| `dela scu_ccyl_mine` / `dela scu_ccyl_credits`                                         | 我参与的活动 / 学分记录                                |
| `dela scu_ccyl_signup '{"activityId":"...","scoreType":""}'`                           | 报名活动（写操作）                                     |
| `dela scu_ccyl_cancel '{"activityId":"..."}'`                                          | 取消报名（写操作）                                     |
| `dela scu_repair_addresses`                                                            | 报修常用地址（含 addressId 与 userId）                 |
| `dela scu_repair_projects '{"areaId":"..."}'`                                          | 报修项目树（提交取叶子 value）                         |
| `dela scu_repair_tickets '{"userId":"..."}'`                                           | 我的报修工单                                           |
| `dela scu_repair_submit '{"addressId":"...","projectId":"...","content":"..."}'`       | 提交报修（写操作）                                     |
| `dela scu_passpoint_devices`                                                           | 校园网无感认证设备列表                                 |
| `dela scu_passpoint_add '{"mac":"aa-bb-cc-dd-ee-ff","expireDays":0}'`                  | 绑定无感设备（写操作）                                 |
| `dela scu_passpoint_cancel '{"mac":"aa-bb-cc-dd-ee-ff"}'`                              | 解绑设备（写操作）                                     |

## 使用要点

- 电费首次查询必须逐级取编号：`scu_balance_campus` → `scu_balance_buildings` → `scu_balance_units`，再把 `room` 一并传给 `scu_balance` 完成绑定；绑定后只需 `type`。
- `scu_balance` 每次成功都会在本地记一条余额快照（保留 365 天，上限 2000 条）。趋势需至少 2 个不同自然日的快照才有日均值；余额上升的区间视为充值并跳过。
- 教室/培养方案/班级课表/课程课表都按“逐级发现编号”使用：先取 index/options，再用返回的 value 或 `id.*` 字段继续查；不要臆造编号。
- 培养方案详情与学分完成是两套接口：`scu_program_detail` 给方案内课程树，`scu_plan_completion` 给已修/未修学分树。
- 成绩与考表返回的是教务系统原始结构；成绩字段随学期变化，不要把某一次的字段名当成稳定契约，原样呈现或按用户要求解释。
- 课表在应用内「课表」页同步，Agent 用 `query_schedule` 查询本地缓存；`scu_semesters` 只用于发现 planCode。
- 没连接统一认证时命令会返回认证错误：引导用户到「校园服务」页重新登录（可点「连接统一认证」走网页，或用顶部「统一认证密码登录」输入学号 + 统一认证密码）。
- 教务处通知是公开页面，不需要登录；先把 `scu_jwc_notices` 的 `url` 交给 `scu_jwc_notice` 取正文，不要自行拼接链接。
- **不要向用户索要密码/验证码**：密码只由用户在界面里输入，验证码由本地 OCR 识别；两者都不会交给模型。
- 密码登录需要的是「统一身份认证」密码（id.scu.edu.cn），不是教务系统密码；两者可能不同。
- 只读查询可以直接调用；涉及报名、提交、缴费等写操作当前未开放，遇到时告知用户到对应官方系统办理。
