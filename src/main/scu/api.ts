/** 川大校园服务主进程编排：统一连接、错误分类与本地房间绑定。 */
import { app } from 'electron';
import type { WebContents } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ScuBalanceInput,
  ScuCardHistory,
  ScuCodeName,
  ScuConnectionState,
  ScuExam,
  ScuNotice,
  ScuNoticeDetail,
  ScuResult,
  ScuSemester,
} from '../../shared/scu';
import {
  CampusAuthError,
  clearCampusSession,
  flushCampusSession,
  openCampusLoginWindow,
} from '../campus';
import { fetchCardHistory, fetchUserProfile, identityOf, resetWfw } from './wfw';
import { currentPlanCode, fetchCurrentWeek, fetchExams, fetchGrades, fetchSemesters } from './zhjw';
import {
  fetchBuildings,
  fetchCampus,
  fetchUnits,
  queryRoomInfo,
  resetPayApp,
  verifyRoom,
} from './payapp';
import { fetchFitnessNotices, fetchFitnessScore, resetFitness } from './fitness';
import { clearIdentity, identityState } from './identity';
import { fetchMyApplications, resetService } from './service';
import {
  balanceTrend,
  recordBalanceSnapshot,
  roomKeyOf,
  type ScuBalanceTrend,
} from './balance-trend';
import {
  fetchClassSchedule,
  fetchClassScheduleOptions,
  fetchClassSubjects,
  fetchClassroomAvailability,
  fetchClassroomIndex,
  fetchClassroomTypes,
  fetchCourseCurriculumOptions,
  fetchCourseSchedule,
  fetchPlanCompletion,
  fetchProgramColleges,
  fetchProgramCourseDetail,
  fetchProgramDetail,
  fetchProgramGrades,
  searchClasses,
  searchCourses,
  searchPrograms,
  type ScuOption,
  type ScuPlanCompletion,
} from './zhjw-extras';
import {
  fetchCloudPrintJobs,
  fetchCloudPrintStatus,
  resetCloudPrint,
  uploadCloudPrint,
} from './cloudprint';
import { fetchJwcNotice, fetchJwcNotices } from './notices';
import {
  fetchServiceForm,
  resetService as resetServiceForm,
  submitServiceForm,
  uploadServiceAttachment,
  validateServiceValues,
} from './service';
import {
  ccylActivityDetail,
  ccylActivityLibrary,
  ccylActivityScoreTypes,
  ccylCredits,
  cancelCcylSignUp,
  cancelCcylSubscribe,
  ccylOrgs,
  exportCcylCredits,
  myCcylActivities,
  orderedCcylActivities,
  resetCcyl,
  searchCcylActivities,
  signUpCcylActivity,
  subscribeCcylActivity,
  type CcylSearchInput,
} from './ccyl';
import {
  evaluateRepair,
  fetchRepairAddresses,
  fetchRepairAreaTree,
  fetchRepairBookDates,
  fetchRepairBookTimes,
  fetchRepairEvaluateProjects,
  fetchRepairProjects,
  fetchRepairTickets,
  resetRepair,
  submitRepair,
  withdrawRepair,
} from './repair';
import {
  addPasspointDevice,
  cancelPasspointDevice,
  fetchPasspointDevices,
  fetchPasspointUser,
  resetPasspoint,
} from './passpoint';

/** 统一认证 → 教务的 SSO 入口（与 SCU-CLI/Bugaoshan 的 jwt23 一致）。 */
const ID_SSO_ZHJW =
  'https://id.scu.edu.cn/enduser/sp/sso/scdxplugin_jwt23?enterpriseId=scdx&target_url=index';

interface BalanceBinding {
  schoolCode: string;
  regCode: string;
  unitCode: string;
  roomNo: string;
}

function bindingPath(): string {
  return join(app.getPath('userData'), 'scu-balance-room.json');
}

function saveBinding(binding: BalanceBinding): void {
  writeFileSync(bindingPath(), JSON.stringify(binding), 'utf8');
}

function loadBinding(): BalanceBinding | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(bindingPath(), 'utf8'));
    const value = parsed as Partial<BalanceBinding> | null;
    return value && typeof value.roomNo === 'string' ? (value as BalanceBinding) : null;
  } catch {
    return null;
  }
}

async function result<T>(fn: () => Promise<T>): Promise<ScuResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      auth: error instanceof CampusAuthError,
    };
  }
}

export async function connectScu(
  sender: WebContents,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return openCampusLoginWindow({
    sender,
    title: '连接四川大学统一身份认证',
    // 走统一认证 SSO 入口：既能拿到教务 cookie，也能建立 id.scu.edu.cn 会话，
    // 后者是微服务（电费/校园卡）、办事大厅、体测等子系统复用的基础。
    url: ID_SSO_ZHJW,
    reached: (url) => {
      try {
        const target = new URL(url);
        return (
          target.hostname === 'zhjw.scu.edu.cn' &&
          !target.pathname.includes('login') &&
          !target.pathname.includes('cas')
        );
      } catch {
        return false;
      }
    },
    probe: async () => {
      await fetchCurrentWeek();
      await flushCampusSession();
    },
  });
}

export async function scuState(): Promise<ScuConnectionState> {
  const identity = identityState();
  let zhjw = true;
  try {
    await fetchCurrentWeek();
  } catch {
    zhjw = false;
  }
  if (!zhjw && !identity.connected) {
    return { connected: false, principal: null, name: null };
  }
  try {
    const profile = identityOf(await fetchUserProfile());
    return {
      connected: true,
      principal: profile.principal ?? identity.principal,
      name: profile.name,
    };
  } catch {
    return { connected: true, principal: identity.principal, name: null };
  }
}

export async function disconnectScu(): Promise<void> {
  resetPayApp();
  resetFitness();
  resetService();
  resetServiceForm();
  resetWfw();
  resetCloudPrint();
  resetCcyl();
  resetRepair();
  resetPasspoint();
  clearIdentity();
  await clearCampusSession();
}

/** 登录身份变化后清空各子系统预热状态，下次调用重新走 SSO。 */
export function resetScuSubsystems(): void {
  resetPayApp();
  resetFitness();
  resetService();
  resetServiceForm();
  resetWfw();
  resetCloudPrint();
  resetCcyl();
  resetRepair();
  resetPasspoint();
}

/** 云打印（只读）：会话检查与任务列表。 */
export function scuCloudPrintStatus(): Promise<ScuResult<{ ready: boolean }>> {
  return result(fetchCloudPrintStatus);
}

export function scuCloudPrintJobs(): Promise<ScuResult<unknown[]>> {
  return result(fetchCloudPrintJobs);
}

/** 教务处通知列表（公开页面，免登录）。 */
export function scuJwcNotices(page = 1): Promise<ScuResult<readonly ScuNotice[]>> {
  return result(() => fetchJwcNotices(page));
}

export function scuJwcNotice(url: string): Promise<ScuResult<ScuNoticeDetail>> {
  return result(() => fetchJwcNotice(url));
}

export function scuUserInfo(): Promise<ScuResult<unknown>> {
  return result(fetchUserProfile);
}

export function scuSemesters(): Promise<ScuResult<readonly ScuSemester[]>> {
  return result(fetchSemesters);
}

export function scuGrades(scheme = false): Promise<ScuResult<unknown>> {
  return result(() => fetchGrades(scheme));
}

export function scuExams(): Promise<ScuResult<readonly ScuExam[]>> {
  return result(fetchExams);
}

export function scuBalanceCampus(): Promise<ScuResult<readonly ScuCodeName[]>> {
  return result(fetchCampus);
}

export function scuBalanceBuildings(
  schoolCode: string,
): Promise<ScuResult<readonly ScuCodeName[]>> {
  return result(() => fetchBuildings(schoolCode));
}

export function scuBalanceUnits(
  schoolCode: string,
  regCode: string,
): Promise<ScuResult<readonly ScuCodeName[]>> {
  return result(() => fetchUnits(schoolCode, regCode));
}

export function scuBalanceQuery(input: ScuBalanceInput): Promise<ScuResult<unknown>> {
  return result(async () => {
    const profile = (await fetchUserProfile()) as {
      realname?: unknown;
      role?: { number?: unknown };
    } | null;
    const cusName = typeof profile?.realname === 'string' ? profile.realname : '';
    const cusNo = typeof profile?.role?.number === 'string' ? profile.role.number : '';
    if (!cusNo) throw new Error('无法从微服务用户信息获取学号');
    if (input.room) {
      const binding: BalanceBinding = {
        schoolCode: input.schoolCode ?? '',
        regCode: input.regCode ?? '',
        unitCode: input.unitCode ?? '',
        roomNo: input.room,
      };
      const verified = await verifyRoom({
        cusNo,
        type: input.type,
        cusName,
        schoolCode: binding.schoolCode,
        regCode: binding.regCode,
        unitCode: binding.unitCode,
        roomNo: binding.roomNo,
      });
      if (!verified) throw new Error('房间绑定失败，请检查校区、楼栋、单元与房间号');
      saveBinding(binding);
    }
    const info = await queryRoomInfo(cusNo, input.type, cusName);
    const binding = loadBinding();
    if (binding) recordBalanceSnapshot(roomKeyOf(binding), input.type, info);
    return info;
  });
}

export function scuFitnessNotices(): Promise<ScuResult<unknown>> {
  return result(fetchFitnessNotices);
}

export function scuBalanceTrend(type: 1 | 2, days = 0): Promise<ScuResult<ScuBalanceTrend>> {
  return result(async () => balanceTrend(type, days));
}

export function scuFitnessScore(year = new Date().getFullYear()): Promise<ScuResult<unknown>> {
  return result(() => fetchFitnessScore(year));
}

export function scuCardTransactions(sdate = '', edate = ''): Promise<ScuResult<ScuCardHistory>> {
  return result(() => fetchCardHistory(sdate, edate));
}

export function scuServiceApplications(status = 0, page = 1): Promise<ScuResult<unknown>> {
  return result(() => fetchMyApplications(status, page));
}

export function defaultPlanCode(): string {
  return currentPlanCode();
}

// ─── 教务扩展查询（教室 / 培养方案 / 班级课表 / 课程课表）────────────

export function scuClassroomIndex(): Promise<ScuResult<unknown>> {
  return result(fetchClassroomIndex);
}

export function scuClassroomTypes(input: {
  campusNumber: string;
  buildingNumber: string;
  campusName: string;
  buildingName: string;
}): Promise<ScuResult<unknown>> {
  return result(() => fetchClassroomTypes(input));
}

export function scuClassroomAvailability(input: {
  campusNumber: string;
  buildingNumber: string;
  classroomType: string;
  classroomName: string;
  seatFrom: string;
  seatTo: string;
  date: string;
}): Promise<ScuResult<unknown>> {
  return result(() => fetchClassroomAvailability(input));
}

export function scuProgramColleges(): Promise<ScuResult<readonly ScuOption[]>> {
  return result(fetchProgramColleges);
}

export function scuProgramGrades(): Promise<ScuResult<readonly ScuOption[]>> {
  return result(fetchProgramGrades);
}

export function scuProgramSearch(input: {
  college?: string;
  grade?: string;
}): Promise<ScuResult<unknown>> {
  return result(() => searchPrograms(input));
}

export function scuProgramDetail(fajhh: string): Promise<ScuResult<unknown>> {
  return result(() => fetchProgramDetail(fajhh));
}

export function scuProgramCourse(urlPath: string): Promise<ScuResult<unknown>> {
  return result(() => fetchProgramCourseDetail(urlPath));
}

export function scuPlanCompletion(): Promise<ScuResult<readonly ScuPlanCompletion[]>> {
  return result(fetchPlanCompletion);
}

export function scuClassOptions(): Promise<ScuResult<unknown>> {
  return result(fetchClassScheduleOptions);
}

export function scuClassSubjects(departmentNum: string): Promise<ScuResult<unknown>> {
  return result(() => fetchClassSubjects(departmentNum));
}

export function scuClassList(input: {
  plan?: string;
  year?: string;
  department?: string;
  subject?: string;
  classNum?: string;
  page?: number;
  pageSize?: number;
}): Promise<ScuResult<unknown>> {
  return result(() => searchClasses(input));
}

export function scuClassSchedule(planCode: string, classCode: string): Promise<ScuResult<unknown>> {
  return result(() => fetchClassSchedule(planCode, classCode));
}

export function scuCourseOptions(): Promise<ScuResult<unknown>> {
  return result(fetchCourseCurriculumOptions);
}

export function scuCourseSearch(input: {
  semester?: string;
  department?: string;
  name?: string;
  code?: string;
  seq?: string;
  category?: string;
  page?: number;
  pageSize?: number;
}): Promise<ScuResult<unknown>> {
  return result(() => searchCourses(input));
}

export function scuCourseSchedule(
  planCode: string,
  courseCode: string,
  courseSeq: string,
): Promise<ScuResult<unknown>> {
  return result(() => fetchCourseSchedule(planCode, courseCode, courseSeq));
}

// ─── 办事大厅动态表单 ────────────────────────────────────────────

export function scuServiceForm(appId: string): Promise<ScuResult<unknown>> {
  return result(() => fetchServiceForm(appId));
}

export function scuServiceSubmit(
  appId: string,
  values: Record<string, unknown>,
): Promise<ScuResult<unknown>> {
  return result(() => submitServiceForm(appId, values));
}

export function scuServiceValidate(
  schema: Parameters<typeof validateServiceValues>[0],
  values: Record<string, unknown>,
): Promise<ScuResult<unknown>> {
  return result(async () => validateServiceValues(schema, values));
}

export function scuServiceAttach(
  appId: string,
  filePaths: readonly string[],
): Promise<ScuResult<readonly unknown[]>> {
  return result(async () => {
    const uploaded: unknown[] = [];
    for (const filePath of filePaths.slice(0, 10))
      uploaded.push(await uploadServiceAttachment(appId, filePath));
    return uploaded;
  });
}

// ─── 第二课堂 ────────────────────────────────────────────────────

export function scuCcylSearch(input: CcylSearchInput): Promise<ScuResult<unknown>> {
  return result(() => searchCcylActivities(input));
}

export function scuCcylMine(page = 1): Promise<ScuResult<unknown>> {
  return result(() => myCcylActivities(page));
}

export function scuCcylOrdered(page = 1, name = ''): Promise<ScuResult<unknown>> {
  return result(() => orderedCcylActivities(page, 20, name));
}

export function scuCcylLibrary(id: string): Promise<ScuResult<unknown>> {
  return result(() => ccylActivityLibrary(id));
}

export function scuCcylActivity(id: string): Promise<ScuResult<unknown>> {
  return result(() => ccylActivityDetail(id));
}

export function scuCcylScoreTypes(libraryId: string): Promise<ScuResult<unknown>> {
  return result(() => ccylActivityScoreTypes(libraryId));
}

export function scuCcylSignUp(activityId: string, scoreType: string): Promise<ScuResult<unknown>> {
  return result(() => signUpCcylActivity(activityId, scoreType));
}

export function scuCcylCancel(activityId: string): Promise<ScuResult<unknown>> {
  return result(() => cancelCcylSignUp(activityId));
}

export function scuCcylSubscribe(libraryId: string): Promise<ScuResult<unknown>> {
  return result(() => subscribeCcylActivity(libraryId));
}

export function scuCcylUnsubscribe(libraryId: string): Promise<ScuResult<unknown>> {
  return result(() => cancelCcylSubscribe(libraryId));
}

export function scuCcylCredits(page = 1): Promise<ScuResult<unknown>> {
  return result(() => ccylCredits(page));
}

export function scuCcylExport(
  creditIds: readonly string[],
  email: string,
): Promise<ScuResult<unknown>> {
  return result(() => exportCcylCredits(creditIds, email));
}

export function scuCcylOrgs(): Promise<ScuResult<unknown>> {
  return result(ccylOrgs);
}

// ─── 在线报修 ────────────────────────────────────────────────────

export function scuRepairAddresses(): Promise<ScuResult<unknown>> {
  return result(fetchRepairAddresses);
}

export function scuRepairAreas(): Promise<ScuResult<unknown>> {
  return result(fetchRepairAreaTree);
}

export function scuRepairProjects(areaId: string): Promise<ScuResult<unknown>> {
  return result(() => fetchRepairProjects(areaId));
}

export function scuRepairBookDates(): Promise<ScuResult<unknown>> {
  return result(fetchRepairBookDates);
}

export function scuRepairBookTimes(date: string): Promise<ScuResult<unknown>> {
  return result(() => fetchRepairBookTimes(date));
}

export function scuRepairTickets(userId: string): Promise<ScuResult<unknown>> {
  return result(() => fetchRepairTickets(userId));
}

export function scuRepairWithdraw(id: string): Promise<ScuResult<unknown>> {
  return result(() => withdrawRepair(id).then(() => ({ withdrawn: true })));
}

export function scuRepairEvaluateProjects(): Promise<ScuResult<unknown>> {
  return result(fetchRepairEvaluateProjects);
}

export function scuRepairEvaluate(input: {
  repairId: string;
  stars: Record<string, number>;
  content?: string;
}): Promise<ScuResult<unknown>> {
  return result(() => evaluateRepair(input).then(() => ({ evaluated: true })));
}

export function scuRepairSubmit(input: {
  addressId: string;
  projectId: string;
  content: string;
  bookDate?: string;
  bookTime?: string;
  allowAbsent?: boolean;
  images?: readonly string[];
}): Promise<ScuResult<unknown>> {
  return result(async () => {
    // 报修人姓名与服务端一致，取自微服务用户信息。
    const profile = await fetchUserProfile().catch(() => null);
    const realname =
      profile && typeof profile === 'object'
        ? String((profile as Record<string, unknown>).realname ?? '')
        : '';
    return submitRepair({ ...input, realname });
  });
}

// ─── 无感认证 ────────────────────────────────────────────────────

export function scuPasspointDevices(): Promise<ScuResult<unknown>> {
  return result(fetchPasspointDevices);
}

export function scuPasspointUser(): Promise<ScuResult<unknown>> {
  return result(fetchPasspointUser);
}

export function scuPasspointAdd(input: {
  mac: string;
  expireDays?: number;
  serviceName?: string;
}): Promise<ScuResult<unknown>> {
  return result(() => addPasspointDevice(input).then(() => ({ added: true })));
}

export function scuPasspointCancel(mac: string): Promise<ScuResult<unknown>> {
  return result(() => cancelPasspointDevice(mac).then(() => ({ canceled: true })));
}

// ─── 云打印上传 ──────────────────────────────────────────────────

export function scuCloudPrintUpload(
  filePath: string,
  options: Parameters<typeof uploadCloudPrint>[1],
): Promise<ScuResult<unknown>> {
  return result(() => uploadCloudPrint(filePath, options));
}
