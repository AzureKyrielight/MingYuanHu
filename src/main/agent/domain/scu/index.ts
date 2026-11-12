/** 川大校园服务 Agent 工具：复用主进程会话与业务 API，不把凭据交给模型。 */
import { z } from 'zod';
import type { ScuResult } from '../../../../shared/scu';
import {
  scuBalanceBuildings,
  scuBalanceCampus,
  scuBalanceQuery,
  scuBalanceTrend,
  scuBalanceUnits,
  scuCardTransactions,
  scuExams,
  scuFitnessNotices,
  scuFitnessScore,
  scuGrades,
  scuSemesters,
  scuServiceApplications,
  scuUserInfo,
  scuCloudPrintJobs,
  scuCloudPrintStatus,
  scuJwcNotice,
  scuJwcNotices,
  scuClassroomAvailability,
  scuClassroomIndex,
  scuClassroomTypes,
  scuClassList,
  scuClassOptions,
  scuClassSchedule,
  scuClassSubjects,
  scuCourseOptions,
  scuCourseSchedule,
  scuCourseSearch,
  scuPlanCompletion,
  scuProgramColleges,
  scuProgramCourse,
  scuProgramDetail,
  scuProgramGrades,
  scuProgramSearch,
  scuServiceForm,
  scuServiceSubmit,
  scuCcylSearch,
  scuCcylMine,
  scuCcylCredits,
  scuCcylSignUp,
  scuCcylCancel,
  scuRepairAddresses,
  scuRepairProjects,
  scuRepairTickets,
  scuRepairSubmit,
  scuPasspointDevices,
  scuPasspointAdd,
  scuPasspointCancel,
} from '../../../scu/api';
import { tool } from '../shared';

async function unwrap<T>(pending: Promise<ScuResult<T>>): Promise<T> {
  const result = await pending;
  if (!result.ok) {
    throw new Error(
      result.auth
        ? `${result.error}（请提示用户到“校园服务”页重新连接统一身份认证）`
        : result.error,
    );
  }
  return result.data;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式为 YYYY-MM-DD');

export const scuWhoamiTool = tool(
  '读取当前四川大学校园账号的基本信息（姓名、学号、院系等，数据来自微服务）。只读，不返回任何密码或 token。',
  z.object({}).strict(),
  () => unwrap(scuUserInfo()),
);

export const scuCloudPrintCheckTool = tool(
  '检查图书馆云打印会话是否可用（只读，不会产生打印任务）。ready=true 表示当前统一认证身份已能访问云打印。',
  z.object({}).strict(),
  () => unwrap(scuCloudPrintStatus()),
);

export const scuCloudPrintJobsTool = tool(
  '列出图书馆云打印任务（只读）。返回任务元数据（任务号、创建/打印时间、页数、份数、状态、费用、纸张明细），不含账号/卡号/姓名。',
  z.object({}).strict(),
  () => unwrap(scuCloudPrintJobs()),
);

export const scuJwcNoticesTool = tool(
  '读取四川大学教务处通知公告列表（公开页面，免登录）。page 从 1 开始（1 为最新），返回 id/title/date/url；详情用 scu_jwc_notice 按 url 获取。',
  z.object({ page: z.number().int().min(1).max(20).default(1) }).strict(),
  ({ page }) => unwrap(scuJwcNotices(page)),
);

export const scuJwcNoticeTool = tool(
  '读取四川大学教务处通知详情（公开页面，免登录）。url 取自 scu_jwc_notices 返回的 url，返回标题、发布时间与正文纯文本。',
  z.object({ url: z.string().url().max(300) }).strict(),
  ({ url }) => unwrap(scuJwcNotice(url)),
);

export const scuGradesTool = tool(
  '读取教务成绩（只读）。默认返回及格成绩；scheme=true 返回培养方案成绩。返回教务系统原始 JSON，字段随学期变化，按接口原样交给用户。',
  z.object({ scheme: z.boolean().default(false) }).strict(),
  ({ scheme }) => unwrap(scuGrades(scheme)),
);

export const scuExamsTool = tool(
  '读取教务考表（只读）：课程、周次、日期、星期、时段、地点、座位号、准考证号与考试提示。',
  z.object({}).strict(),
  () => unwrap(scuExams()),
);

export const scuBalanceTool = tool(
  '查询宿舍电费余额（只读，数据来自川大缴费平台）。type=1 照明电费、type=2 空调电费。首次查询某个房间必须同时提供 schoolCode/regCode/unitCode/room；之后服务端会记住绑定，可只传 type。编号可用 scu_balance_campus 等命令逐级发现。',
  z
    .object({
      type: z.union([z.literal(1), z.literal(2)]).default(1),
      schoolCode: z.string().trim().min(1).optional(),
      regCode: z.string().trim().min(1).optional(),
      unitCode: z.string().trim().min(1).optional(),
      room: z.string().trim().min(1).optional(),
    })
    .strict(),
  (input) => unwrap(scuBalanceQuery(input)),
);

export const scuBalanceTrendTool = tool(
  '分析宿舍电费消耗趋势（只读，基于本地快照）。每次 scu_balance 查询成功会自动记一条快照；本工具按北京自然日聚合，返回日代表点、日均费用/度数、累计消耗与充值段数。type=1 照明电费、type=2 空调电费；days>0 只统计最近 N 天。快照不足 2 天时日均值为 0，需先用 scu_balance 多查询几天。',
  z
    .object({
      type: z.union([z.literal(1), z.literal(2)]).default(1),
      days: z.number().int().min(0).max(3650).default(0),
    })
    .strict(),
  ({ type, days }) => unwrap(scuBalanceTrend(type, days)),
);

export const scuFitnessTool = tool(
  '读取体测数据（只读）。kind=score 返回指定学年体测成绩（year 默认今年）；kind=notices 返回体测通知列表。',
  z
    .object({
      kind: z.enum(['score', 'notices']),
      year: z.number().int().min(2000).max(2100).optional(),
    })
    .strict(),
  ({ kind, year }) => unwrap(kind === 'score' ? scuFitnessScore(year) : scuFitnessNotices()),
);

export const scuCardTransactionsTool = tool(
  '查询校园卡扣费/充值明细（只读）。sdate/edate 为 YYYY-MM-DD，可省略（服务端返回最近几天）。返回按时间升序的明细、每日消费合计、区间总消费与最新余额。',
  z.object({ sdate: dateSchema.optional(), edate: dateSchema.optional() }).strict(),
  ({ sdate, edate }) => unwrap(scuCardTransactions(sdate, edate)),
);

export const scuServiceApplicationsTool = tool(
  '查询网上办事大厅“我的申请”（只读）。status=0 全部、1 进行中/草稿、3 已完成；page 从 1 开始，每页 20 条。展示状态以返回项的 inst_status 中文字段为准。',
  z
    .object({
      status: z.union([z.literal(0), z.literal(1), z.literal(3)]).default(0),
      page: z.number().int().min(1).max(999).default(1),
    })
    .strict(),
  ({ status, page }) => unwrap(scuServiceApplications(status, page)),
);

export const scuSemestersTool = tool(
  '列出教务学期（只读）。返回的 value 是川大 planCode（如 2025-2026-2-1），用于学期课表同步与查询。',
  z.object({}).strict(),
  () => unwrap(scuSemesters()),
);

export const scuBalanceCampusTool = tool(
  '列出电费缴费平台的校区（只读）。返回项的 code 作为 scu_balance 的 schoolCode。',
  z.object({}).strict(),
  () => unwrap(scuBalanceCampus()),
);

export const scuBalanceBuildingsTool = tool(
  '列出指定校区的楼栋（只读）。schoolCode 取自 scu_balance_campus 的 code；返回项的 code 作为 scu_balance 的 regCode。',
  z.object({ schoolCode: z.string().trim().min(1) }).strict(),
  ({ schoolCode }) => unwrap(scuBalanceBuildings(schoolCode)),
);

export const scuBalanceUnitsTool = tool(
  '列出指定楼栋的单元（只读）。schoolCode/regCode 分别取自 campus 与 buildings 的 code；返回项的 code 作为 scu_balance 的 unitCode。',
  z.object({ schoolCode: z.string().trim().min(1), regCode: z.string().trim().min(1) }).strict(),
  ({ schoolCode, regCode }) => unwrap(scuBalanceUnits(schoolCode, regCode)),
);

export const scuClassroomIndexTool = tool(
  '列出空闲教室查询所需的校区与教学楼（只读）。campuses[].campusNumber 与 buildings[].teachingBuildingNumber 供 scu_classroom_types 与 scu_classroom 使用。',
  z.object({}).strict(),
  () => unwrap(scuClassroomIndex()),
);

export const scuClassroomTypesTool = tool(
  '列出指定教学楼的教室类型（只读）。四个参数均取自 scu_classroom_index：campusNumber/campusName 来自 campuses，buildingNumber/buildingName 来自 buildings。',
  z
    .object({
      campusNumber: z.string().trim().min(1),
      buildingNumber: z.string().trim().min(1),
      campusName: z.string().default(''),
      buildingName: z.string().default(''),
    })
    .strict(),
  (input) => unwrap(scuClassroomTypes(input)),
);

export const scuClassroomTool = tool(
  '查询某天教室占用情况（只读）。编号取自 scu_classroom_index，类型取自 scu_classroom_types；classroomType/classroomName/seatFrom/seatTo 可空，date 为 YYYY-MM-DD（空为当天）。返回教务原始 JSON。',
  z
    .object({
      campusNumber: z.string().trim().min(1),
      buildingNumber: z.string().trim().min(1),
      classroomType: z.string().default(''),
      classroomName: z.string().default(''),
      seatFrom: z.string().default(''),
      seatTo: z.string().default(''),
      date: z.union([dateSchema, z.literal('')]).default(''),
    })
    .strict(),
  (input) => unwrap(scuClassroomAvailability(input)),
);

export const scuProgramCollegesTool = tool(
  '列出培养方案筛选用的学院（只读）。返回 value/label，value 供 scu_program_search 的 college 使用。',
  z.object({}).strict(),
  () => unwrap(scuProgramColleges()),
);

export const scuProgramGradesTool = tool(
  '列出培养方案筛选用的年级（只读）。value 供 scu_program_search 的 grade 使用。',
  z.object({}).strict(),
  () => unwrap(scuProgramGrades()),
);

export const scuProgramSearchTool = tool(
  '搜索培养方案（只读）。college/grade 取自 scu_program_colleges / scu_program_grades；返回记录中的方案号供 scu_program_detail 使用。',
  z.object({ college: z.string().optional(), grade: z.string().optional() }).strict(),
  (input) => unwrap(scuProgramSearch(input)),
);

export const scuProgramDetailTool = tool(
  '获取培养方案详情（只读）。fajhh 取自 scu_program_search 记录；返回 treeList 节点，其中的 urlPath 供 scu_program_course 使用。',
  z.object({ fajhh: z.string().trim().min(1) }).strict(),
  ({ fajhh }) => unwrap(scuProgramDetail(fajhh)),
);

export const scuProgramCourseTool = tool(
  '获取培养方案中的课程详情（只读）。urlPath 取自 scu_program_detail 的 treeList 节点，必须以 / 开头。',
  z
    .object({
      urlPath: z
        .string()
        .trim()
        .min(1)
        .refine((value) => value.startsWith('/')),
    })
    .strict(),
  ({ urlPath }) => unwrap(scuProgramCourse(urlPath)),
);

export const scuPlanCompletionTool = tool(
  '获取培养方案学分完成情况（只读）。返回每份方案的 zNodes 树节点（教务原始结构），用于统计已修/未修学分。多方案账号会逐份读取，可能耗时数秒。',
  z.object({}).strict(),
  () => unwrap(scuPlanCompletion()),
);

export const scuClassOptionsTool = tool(
  '列出班级课表筛选选项（只读）：semesters（executiveEducationPlanNum）、grades（yearNum）、departments（departmentNum）。',
  z.object({}).strict(),
  () => unwrap(scuClassOptions()),
);

export const scuClassSubjectsTool = tool(
  '按院系列出专业（只读）。departmentNum 取自 scu_class_options 的 departments[].value；返回项供 scu_class_list 的 subject 使用。',
  z.object({ departmentNum: z.string().trim().min(1) }).strict(),
  ({ departmentNum }) => unwrap(scuClassSubjects(departmentNum)),
);

export const scuClassListTool = tool(
  '搜索班级（只读）。参数取自 scu_class_options / scu_class_subjects；返回记录的 id.executiveEducationPlanNumber 与 id.classNum 供 scu_class_schedule 使用。',
  z
    .object({
      plan: z.string().optional(),
      year: z.string().optional(),
      department: z.string().optional(),
      subject: z.string().optional(),
      classNum: z.string().optional(),
      page: z.number().int().min(1).max(999).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  (input) => unwrap(scuClassList(input)),
);

export const scuClassScheduleTool = tool(
  '读取指定班级的课表（只读）。planCode 取自 scu_class_list 的 id.executiveEducationPlanNumber，classCode 取自 id.classNum。返回结构与课表页一致。',
  z.object({ planCode: z.string().trim().min(1), classCode: z.string().trim().min(1) }).strict(),
  ({ planCode, classCode }) => unwrap(scuClassSchedule(planCode, classCode)),
);

export const scuCourseOptionsTool = tool(
  '列出课程课表筛选选项（只读）：semesters（zxjxjhh）、departments（kkxsh）、categories（kclb）。',
  z.object({}).strict(),
  () => unwrap(scuCourseOptions()),
);

export const scuCourseSearchTool = tool(
  '搜索课程（教学班，只读）。筛选参数取自 scu_course_options；返回记录的 ZXJXJHH/KCH/KXH 供 scu_course_schedule 使用。',
  z
    .object({
      semester: z.string().optional(),
      department: z.string().optional(),
      name: z.string().optional(),
      code: z.string().optional(),
      seq: z.string().optional(),
      category: z.string().optional(),
      page: z.number().int().min(1).max(999).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  (input) => unwrap(scuCourseSearch(input)),
);

export const scuCourseScheduleTool = tool(
  '读取某门课程（教学班）的排课（只读）。三元组取自 scu_course_search 记录的 ZXJXJHH/KCH/KXH；返回结构与班级课表一致。',
  z
    .object({
      planCode: z.string().trim().min(1),
      courseCode: z.string().trim().min(1),
      courseSeq: z.string().trim().min(1),
    })
    .strict(),
  ({ planCode, courseCode, courseSeq }) =>
    unwrap(scuCourseSchedule(planCode, courseCode, courseSeq)),
);

export const scuServiceFormTool = tool(
  '读取办事大厅事项的动态表单定义（只读）。appId 是事项 id；返回 formId 与字段列表（key/type/label/是否必填/选项）。填表时用字段 key 作为 scu_service_submit 的 values 键。',
  z.object({ appId: z.string().trim().min(1).max(64) }).strict(),
  ({ appId }) => unwrap(scuServiceForm(appId)),
);

export const scuServiceSubmitTool = tool(
  '提交办事大厅事项（写操作，会真实发起流程）。values 的键取自 scu_service_form 返回的字段 key；附件字段需要用户先在界面上传并传入 {name,url,id} 数组。',
  z
    .object({
      appId: z.string().trim().min(1).max(64),
      values: z.record(z.string(), z.unknown()),
    })
    .strict(),
  ({ appId, values }) => unwrap(scuServiceSubmit(appId, values)),
);

export const scuCcylActivitiesTool = tool(
  '搜索四川大学第二课堂活动库（只读）。name 为活动名关键词；返回活动 id、名称、组织、时间与状态。',
  z
    .object({
      name: z.string().trim().max(100).optional(),
      page: z.number().int().min(1).max(999).optional(),
    })
    .strict(),
  (input) => unwrap(scuCcylSearch(input)),
);

export const scuCcylMineTool = tool(
  '列出我参与的第二课堂活动（只读）。返回活动 id、名称与报名状态。',
  z.object({ page: z.number().int().min(1).max(999).optional() }).strict(),
  ({ page }) => unwrap(scuCcylMine(page ?? 1)),
);

export const scuCcylCreditsTool = tool(
  '读取第二课堂学分/成绩单（只读）。',
  z.object({ page: z.number().int().min(1).max(999).optional() }).strict(),
  ({ page }) => unwrap(scuCcylCredits(page ?? 1)),
);

export const scuCcylSignUpTool = tool(
  '报名第二课堂活动（写操作）。activityId 取自 scu_ccyl_activities；scoreType 为空时按服务端默认可选类型提交。',
  z
    .object({
      activityId: z.string().trim().min(1).max(64),
      scoreType: z.string().trim().max(64).default(''),
    })
    .strict(),
  ({ activityId, scoreType }) => unwrap(scuCcylSignUp(activityId, scoreType)),
);

export const scuCcylCancelTool = tool(
  '取消已报名的第二课堂活动（写操作）。',
  z.object({ activityId: z.string().trim().min(1).max(64) }).strict(),
  ({ activityId }) => unwrap(scuCcylCancel(activityId)),
);

export const scuRepairAddressesTool = tool(
  '读取智慧后勤报修的常用地址（只读）。返回地址 id、区域 id/名称、详细地址与联系电话；提交报修时用 addressId。',
  z.object({}).strict(),
  () => unwrap(scuRepairAddresses()),
);

export const scuRepairProjectsTool = tool(
  '读取某区域的报修项目树（只读）。areaId 取自 scu_repair_addresses；提交时报 projectId 用叶子节点的 value。',
  z.object({ areaId: z.string().trim().min(1).max(64) }).strict(),
  ({ areaId }) => unwrap(scuRepairProjects(areaId)),
);

export const scuRepairTicketsTool = tool(
  '读取我的报修工单（只读）。userId 取自 scu_repair_addresses 返回的 userId。',
  z.object({ userId: z.string().trim().min(1).max(64) }).strict(),
  ({ userId }) => unwrap(scuRepairTickets(userId)),
);

export const scuRepairSubmitTool = tool(
  '提交在线报修工单（写操作）。需要 addressId、projectId（叶子 value）与故障描述；预约日期/时段可选。现场照片需用户先在界面上选好，模型只能传已选路径。',
  z
    .object({
      addressId: z.string().trim().min(1).max(64),
      projectId: z.string().trim().min(1).max(64),
      content: z.string().trim().min(1).max(2000),
      bookDate: dateSchema.optional(),
      bookTime: z.string().trim().max(64).optional(),
      allowAbsent: z.boolean().optional(),
      images: z.array(z.string().min(1).max(1024)).max(3).optional(),
    })
    .strict(),
  (input) => unwrap(scuRepairSubmit(input)),
);

export const scuPasspointDevicesTool = tool(
  '读取校园网无感认证（passpoint）已绑定设备（只读）。返回 MAC、到期日、服务名与是否在线。',
  z.object({}).strict(),
  () => unwrap(scuPasspointDevices()),
);

export const scuPasspointAddTool = tool(
  '绑定校园网无感认证设备（写操作）。mac 支持 aa-bb-cc-dd-ee-ff 或 aa:bb:...；expireDays 为 0-365，0 表示最长有效期。',
  z
    .object({
      mac: z.string().trim().min(11).max(32),
      expireDays: z.number().int().min(0).max(365).optional(),
      serviceName: z.string().trim().max(32).optional(),
    })
    .strict(),
  (input) => unwrap(scuPasspointAdd(input)),
);

export const scuPasspointCancelTool = tool(
  '解绑校园网无感认证设备（写操作）。',
  z.object({ mac: z.string().trim().min(11).max(32) }).strict(),
  ({ mac }) => unwrap(scuPasspointCancel(mac)),
);

export const scuTools = {
  scu_whoami: scuWhoamiTool,
  scu_cloudprint_check: scuCloudPrintCheckTool,
  scu_cloudprint_jobs: scuCloudPrintJobsTool,
  scu_jwc_notices: scuJwcNoticesTool,
  scu_jwc_notice: scuJwcNoticeTool,
  scu_grades: scuGradesTool,
  scu_exams: scuExamsTool,
  scu_semesters: scuSemestersTool,
  scu_balance: scuBalanceTool,
  scu_balance_trend: scuBalanceTrendTool,
  scu_balance_campus: scuBalanceCampusTool,
  scu_balance_buildings: scuBalanceBuildingsTool,
  scu_balance_units: scuBalanceUnitsTool,
  scu_fitness: scuFitnessTool,
  scu_card_transactions: scuCardTransactionsTool,
  scu_service_applications: scuServiceApplicationsTool,
  scu_classroom_index: scuClassroomIndexTool,
  scu_classroom_types: scuClassroomTypesTool,
  scu_classroom: scuClassroomTool,
  scu_program_colleges: scuProgramCollegesTool,
  scu_program_grades: scuProgramGradesTool,
  scu_program_search: scuProgramSearchTool,
  scu_program_detail: scuProgramDetailTool,
  scu_program_course: scuProgramCourseTool,
  scu_plan_completion: scuPlanCompletionTool,
  scu_class_options: scuClassOptionsTool,
  scu_class_subjects: scuClassSubjectsTool,
  scu_class_list: scuClassListTool,
  scu_class_schedule: scuClassScheduleTool,
  scu_course_options: scuCourseOptionsTool,
  scu_course_search: scuCourseSearchTool,
  scu_course_schedule: scuCourseScheduleTool,
  scu_service_form: scuServiceFormTool,
  scu_service_submit: scuServiceSubmitTool,
  scu_ccyl_activities: scuCcylActivitiesTool,
  scu_ccyl_mine: scuCcylMineTool,
  scu_ccyl_credits: scuCcylCreditsTool,
  scu_ccyl_signup: scuCcylSignUpTool,
  scu_ccyl_cancel: scuCcylCancelTool,
  scu_repair_addresses: scuRepairAddressesTool,
  scu_repair_projects: scuRepairProjectsTool,
  scu_repair_tickets: scuRepairTicketsTool,
  scu_repair_submit: scuRepairSubmitTool,
  scu_passpoint_devices: scuPasspointDevicesTool,
  scu_passpoint_add: scuPasspointAddTool,
  scu_passpoint_cancel: scuPasspointCancelTool,
};
