/** 四川大学校园服务的渲染层契约。数据只经主进程请求，凭据与会话不进 renderer。 */
export interface ScuSemester {
  readonly value: string;
  readonly label: string;
}

export interface ScuExam {
  readonly courseName: string;
  readonly week: string;
  readonly date: string;
  readonly weekday: string;
  readonly timeRange: string;
  readonly location: string;
  readonly seatNumber: string;
  readonly ticketNumber: string;
  readonly tip: string;
}

export interface ScuCodeName {
  readonly name: string;
  readonly code: string;
}

/** HTML select 选项（教务筛选器统一用 value/label）。 */
export interface ScuOption {
  readonly value: string;
  readonly label: string;
}

/** 教务处通知公告条目。 */
export interface ScuNotice {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly url: string;
}

export interface ScuNoticeDetail extends ScuNotice {
  readonly content: string;
}

export interface ScuClassroomTypesInput {
  readonly campusNumber: string;
  readonly buildingNumber: string;
  readonly campusName: string;
  readonly buildingName: string;
}

export interface ScuClassroomAvailabilityInput {
  readonly campusNumber: string;
  readonly buildingNumber: string;
  readonly classroomType: string;
  readonly classroomName: string;
  readonly seatFrom: string;
  readonly seatTo: string;
  readonly date: string;
}

export interface ScuProgramSearchInput {
  readonly college?: string;
  readonly grade?: string;
}

export interface ScuClassListInput {
  readonly plan?: string;
  readonly year?: string;
  readonly department?: string;
  readonly subject?: string;
  readonly classNum?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface ScuCourseSearchInput {
  readonly semester?: string;
  readonly department?: string;
  readonly name?: string;
  readonly code?: string;
  readonly seq?: string;
  readonly category?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface ScuPlanCompletion {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly unknown[];
}

export interface ScuPagedRecords {
  readonly records: readonly unknown[];
  readonly total: number;
}

export interface ScuBalanceDailyPoint {
  readonly day: string;
  readonly timestamp: number;
  readonly balance: number;
  readonly price: number;
}

export interface ScuBalanceTrend {
  readonly dailyPoints: readonly ScuBalanceDailyPoint[];
  readonly dailyAvgCost: number;
  readonly dailyAvgKwh: number;
  readonly totalCost: number;
  readonly totalKwh: number;
  readonly totalDays: number;
  readonly skippedRechargeSegments: number;
  readonly recordCount: number;
  readonly firstRecordAt: string | null;
  readonly lastRecordAt: string | null;
  readonly currentPrice: number;
}

export interface ScuCardTransaction {
  readonly toname: string;
  readonly jdate: number;
  readonly xfje: number;
  readonly syje: number;
  readonly type: string;
  readonly time: string;
  readonly day: string;
}

export interface ScuCardHistory {
  readonly transactions: readonly ScuCardTransaction[];
  readonly byDay: Readonly<Record<string, number>>;
  readonly totalCost: number;
  readonly txnCount: number;
  readonly balance: number | null;
  readonly balanceAsOf: string;
}

export interface ScuBalanceInput {
  readonly type: 1 | 2;
  readonly schoolCode?: string;
  readonly regCode?: string;
  readonly unitCode?: string;
  readonly room?: string;
}

export interface ScuConnectionState {
  readonly connected: boolean;
  readonly principal: string | null;
  readonly name: string | null;
}

/** 统一认证 password 授权换取的 token（仅主进程内存，不落盘）。 */
export interface ScuIdentityState {
  readonly connected: boolean;
  readonly principal: string | null;
  readonly expiresAt: string | null;
}

export interface ScuIdentityCaptcha {
  readonly code: string;
  readonly image: string;
}

export interface ScuIdentityLoginInput {
  readonly username: string;
  readonly password: string;
  readonly captchaCode: string;
  readonly captchaText: string;
}

export interface ScuIdentityAutoLoginInput {
  readonly username: string;
  readonly password: string;
}

export type ScuResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string; readonly auth: boolean };

export interface ScuApi {
  /** 打开川大统一身份认证窗口；成功后校园会话与其他子站 SSO 一并可用。 */
  connect(): Promise<{ ok: true } | { ok: false; error: string }>;
  disconnect(): Promise<void>;
  state(): Promise<ScuConnectionState>;
  userInfo(): Promise<ScuResult<unknown>>;
  semesters(): Promise<ScuResult<readonly ScuSemester[]>>;
  grades(scheme?: boolean): Promise<ScuResult<unknown>>;
  exams(): Promise<ScuResult<readonly ScuExam[]>>;
  balanceCampus(): Promise<ScuResult<readonly ScuCodeName[]>>;
  balanceBuildings(schoolCode: string): Promise<ScuResult<readonly ScuCodeName[]>>;
  balanceUnits(schoolCode: string, regCode: string): Promise<ScuResult<readonly ScuCodeName[]>>;
  balanceQuery(input: ScuBalanceInput): Promise<ScuResult<unknown>>;
  /** 基于本地快照的余额趋势；每次查询成功自动记录一条。 */
  balanceTrend(type: 1 | 2, days?: number): Promise<ScuResult<ScuBalanceTrend>>;
  fitnessNotices(): Promise<ScuResult<unknown>>;
  fitnessScore(year?: number): Promise<ScuResult<unknown>>;
  cardTransactions(sdate?: string, edate?: string): Promise<ScuResult<ScuCardHistory>>;
  serviceApplications(status?: number, page?: number): Promise<ScuResult<unknown>>;
  /** 教务处通知公告（公开页面，免登录）。 */
  jwcNotices(page?: number): Promise<ScuResult<readonly ScuNotice[]>>;
  jwcNotice(url: string): Promise<ScuResult<ScuNoticeDetail>>;
  /** 图书馆云打印（只读）：会话检查与任务列表。 */
  cloudPrintStatus(): Promise<ScuResult<{ ready: boolean }>>;
  cloudPrintJobs(): Promise<ScuResult<readonly unknown[]>>;

  /** 统一认证增强登录：密码仅本次调用使用，token 只存内存。 */
  identityState(): Promise<ScuIdentityState>;
  identityCaptcha(): Promise<ScuIdentityCaptcha>;
  identityLogin(input: ScuIdentityLoginInput): Promise<ScuIdentityState>;
  identityLoginAuto(input: ScuIdentityAutoLoginInput): Promise<ScuIdentityState>;
  identityLogout(): Promise<ScuIdentityState>;

  /** 空闲教室查询（编号链路见设置页或 Agent 的说明）。 */
  classroomIndex(): Promise<
    ScuResult<{ campuses: readonly unknown[]; buildings: readonly unknown[] }>
  >;
  classroomTypes(input: ScuClassroomTypesInput): Promise<ScuResult<readonly unknown[]>>;
  classroomAvailability(input: ScuClassroomAvailabilityInput): Promise<ScuResult<unknown>>;
  /** 培养方案与学分完成度。 */
  programColleges(): Promise<ScuResult<readonly ScuOption[]>>;
  programGrades(): Promise<ScuResult<readonly ScuOption[]>>;
  programSearch(input?: ScuProgramSearchInput): Promise<ScuResult<readonly unknown[]>>;
  programDetail(fajhh: string): Promise<ScuResult<unknown>>;
  programCourse(urlPath: string): Promise<ScuResult<unknown>>;
  planCompletion(): Promise<ScuResult<readonly ScuPlanCompletion[]>>;
  /** 班级课表。 */
  classOptions(): Promise<
    ScuResult<{
      semesters: readonly ScuOption[];
      grades: readonly ScuOption[];
      departments: readonly ScuOption[];
    }>
  >;
  classSubjects(departmentNum: string): Promise<ScuResult<readonly unknown[]>>;
  classList(input?: ScuClassListInput): Promise<ScuResult<ScuPagedRecords>>;
  classSchedule(planCode: string, classCode: string): Promise<ScuResult<readonly unknown[]>>;
  /** 课程课表。 */
  courseOptions(): Promise<
    ScuResult<{
      semesters: readonly ScuOption[];
      departments: readonly ScuOption[];
      categories: readonly ScuOption[];
    }>
  >;
  courseSearch(input?: ScuCourseSearchInput): Promise<ScuResult<ScuPagedRecords>>;
  courseSchedule(
    planCode: string,
    courseCode: string,
    courseSeq: string,
  ): Promise<ScuResult<readonly unknown[]>>;
}
