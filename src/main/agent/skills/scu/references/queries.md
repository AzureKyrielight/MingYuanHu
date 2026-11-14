# 查询流程与编号

先用 `dela help '{"command":"命令名"}'` 取目标 schema；以下只列流程，不重复参数定义。

| 任务         | 命令与流程                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前账号     | `scu_whoami`                                                                                                                                                                                         |
| 成绩 / 考试  | `scu_grades` / `scu_exams`；教务原始 JSON，字段可能随学期变化                                                                                                                                        |
| 本人课表     | 应用「课表」页同步，`query_schedule` 查本地缓存；`scu_semesters` 的 value 是 planCode                                                                                                                |
| 电费         | `scu_balance_campus` → `scu_balance_buildings` → `scu_balance_units`，code 分别作 schoolCode/regCode/unitCode；首次连同 room 传给 `scu_balance`，绑定后只传 type（1 照明 / 2 空调）                  |
| 电费趋势     | `scu_balance_trend`；余额查询成功会留本地快照，至少两个北京自然日才有日均值；余额上升按充值跳过                                                                                                      |
| 体测         | `scu_fitness` 的 kind 为 score 或 notices                                                                                                                                                            |
| 校园卡       | `scu_card_transactions`；可选 sdate/edate，格式 YYYY-MM-DD                                                                                                                                           |
| 办事大厅申请 | `scu_service_applications`，status 0 全部 / 1 进行中 / 3 已完成；以 inst_status 中文字段展示状态                                                                                                     |
| 教务通知     | `scu_jwc_notices` → `scu_jwc_notice`，使用返回 url，不拼接详情地址                                                                                                                                   |
| 空闲教室     | `scu_classroom_index` → `scu_classroom_types` → `scu_classroom`；日期 YYYY-MM-DD                                                                                                                     |
| 培养方案     | `scu_program_colleges` / `scu_program_grades` → `scu_program_search` → `scu_program_detail`（fajhh）→ `scu_program_course`（treeList 的 urlPath）；`scu_plan_completion` 是另一套已修/未修学分树接口 |
| 班级课表     | `scu_class_options` → `scu_class_subjects` → `scu_class_list` → `scu_class_schedule`；planCode/classCode 取 id.executiveEducationPlanNumber / id.classNum                                            |
| 课程排课     | `scu_course_options` → `scu_course_search` → `scu_course_schedule`；三元组取 ZXJXJHH/KCH/KXH                                                                                                         |
| 第二课堂     | `scu_ccyl_activities` 搜索活动库；`scu_ccyl_mine` / `scu_ccyl_credits` 查本人活动 / 学分                                                                                                             |
| 报修         | `scu_repair_addresses` → `scu_repair_projects` / `scu_repair_tickets`；工单查询的 userId 来自地址返回                                                                                                |
| 无感认证     | `scu_passpoint_devices`                                                                                                                                                                              |
| 云打印       | `scu_cloudprint_check` / `scu_cloudprint_jobs`，只读，不产生打印任务                                                                                                                                 |

## 公开政策与公告

保研/推免、校企合作、就业公告等先明确适用年份、学院与主题；优先学校、教务处、研究生院、学院及就业部门的官方来源。可先查 `scu_jwc_notices` 的公告标题，命中后读取详情；需要跨部门或历史检索时用 `web_search`，查询包含年份、学院、主题与官方域名。找到官方页面后用 `web_fetch` 读取正文，并按需读取其中的附件；不要只凭搜索摘要或往年规定判断本年资格。搜索不可用时说明限制，不要反复查询个人校园接口替代政策检索。

第二课堂搜索返回活动库 ID，不保证是可报名场次 ID。当前命令桥未提供活动详情/订阅发现链；不能把活动库 ID 直接当 activityId 报名，也不能猜场次编号。
