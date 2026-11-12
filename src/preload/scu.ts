import { ipcRenderer } from 'electron';
import type {
  ScuApi,
  ScuBalanceInput,
  ScuClassroomAvailabilityInput,
  ScuClassroomTypesInput,
  ScuClassListInput,
  ScuCloudPrintOptions,
  ScuCourseSearchInput,
  ScuIdentityAutoLoginInput,
  ScuIdentityLoginInput,
  ScuProgramSearchInput,
  ScuRepairSubmitInput,
} from '../shared/scu';

export const scu: ScuApi = {
  connect: () => ipcRenderer.invoke('scu:connect'),
  disconnect: () => ipcRenderer.invoke('scu:disconnect'),
  state: () => ipcRenderer.invoke('scu:state'),
  identityState: () => ipcRenderer.invoke('scu:identity-state'),
  identityCaptcha: () => ipcRenderer.invoke('scu:identity-captcha'),
  identityLogin: (input: ScuIdentityLoginInput) => ipcRenderer.invoke('scu:identity-login', input),
  identityLoginAuto: (input: ScuIdentityAutoLoginInput) =>
    ipcRenderer.invoke('scu:identity-login-auto', input),
  identityLogout: () => ipcRenderer.invoke('scu:identity-logout'),
  userInfo: () => ipcRenderer.invoke('scu:user-info'),
  semesters: () => ipcRenderer.invoke('scu:semesters'),
  grades: (scheme = false) => ipcRenderer.invoke('scu:grades', scheme),
  exams: () => ipcRenderer.invoke('scu:exams'),
  balanceCampus: () => ipcRenderer.invoke('scu:balance-campus'),
  balanceBuildings: (schoolCode: string) => ipcRenderer.invoke('scu:balance-buildings', schoolCode),
  balanceUnits: (schoolCode: string, regCode: string) =>
    ipcRenderer.invoke('scu:balance-units', schoolCode, regCode),
  balanceQuery: (input: ScuBalanceInput) => ipcRenderer.invoke('scu:balance-query', input),
  balanceTrend: (type: 1 | 2, days = 0) => ipcRenderer.invoke('scu:balance-trend', type, days),
  fitnessNotices: () => ipcRenderer.invoke('scu:fitness-notices'),
  fitnessScore: (year?: number) => ipcRenderer.invoke('scu:fitness-score', year),
  cardTransactions: (sdate = '', edate = '') =>
    ipcRenderer.invoke('scu:card-transactions', sdate, edate),
  serviceApplications: (status = 0, page = 1) =>
    ipcRenderer.invoke('scu:service-applications', status, page),
  cloudPrintStatus: () => ipcRenderer.invoke('scu:cloudprint-status'),
  cloudPrintJobs: () => ipcRenderer.invoke('scu:cloudprint-jobs'),
  cloudPrintUpload: (options: ScuCloudPrintOptions) =>
    ipcRenderer.invoke('scu:cloudprint-upload', options),
  serviceForm: (appId: string) => ipcRenderer.invoke('scu:service-form', appId),
  serviceAttach: (appId: string) => ipcRenderer.invoke('scu:service-attach', appId),
  serviceSubmit: (appId: string, values: Record<string, unknown>) =>
    ipcRenderer.invoke('scu:service-submit', appId, values),
  ccylSearch: (input) => ipcRenderer.invoke('scu:ccyl-search', input ?? {}),
  ccylMine: (page = 1) => ipcRenderer.invoke('scu:ccyl-mine', page),
  ccylOrdered: (page = 1, name = '') => ipcRenderer.invoke('scu:ccyl-ordered', page, name),
  ccylLibrary: (id: string) => ipcRenderer.invoke('scu:ccyl-library', id),
  ccylActivity: (id: string) => ipcRenderer.invoke('scu:ccyl-activity', id),
  ccylScoreTypes: (libraryId: string) => ipcRenderer.invoke('scu:ccyl-score-types', libraryId),
  ccylSignUp: (activityId: string, scoreType: string) =>
    ipcRenderer.invoke('scu:ccyl-signup', activityId, scoreType),
  ccylCancel: (activityId: string) => ipcRenderer.invoke('scu:ccyl-cancel', activityId),
  ccylSubscribe: (libraryId: string) => ipcRenderer.invoke('scu:ccyl-subscribe', libraryId),
  ccylUnsubscribe: (libraryId: string) => ipcRenderer.invoke('scu:ccyl-unsubscribe', libraryId),
  ccylCredits: (page = 1) => ipcRenderer.invoke('scu:ccyl-credits', page),
  ccylExport: (creditIds: readonly string[], email: string) =>
    ipcRenderer.invoke('scu:ccyl-export', creditIds, email),
  ccylOrgs: () => ipcRenderer.invoke('scu:ccyl-orgs'),
  repairAddresses: () => ipcRenderer.invoke('scu:repair-addresses'),
  repairAreas: () => ipcRenderer.invoke('scu:repair-areas'),
  repairProjects: (areaId: string) => ipcRenderer.invoke('scu:repair-projects', areaId),
  repairBookDates: () => ipcRenderer.invoke('scu:repair-book-dates'),
  repairBookTimes: (date: string) => ipcRenderer.invoke('scu:repair-book-times', date),
  repairTickets: (userId: string) => ipcRenderer.invoke('scu:repair-tickets', userId),
  repairWithdraw: (id: string) => ipcRenderer.invoke('scu:repair-withdraw', id),
  repairEvaluateProjects: () => ipcRenderer.invoke('scu:repair-evaluate-projects'),
  repairEvaluate: (input: { repairId: string; stars: Record<string, number>; content?: string }) =>
    ipcRenderer.invoke('scu:repair-evaluate', input),
  repairPickImages: () => ipcRenderer.invoke('scu:repair-pick-images'),
  repairSubmit: (input: ScuRepairSubmitInput) => ipcRenderer.invoke('scu:repair-submit', input),
  passpointDevices: () => ipcRenderer.invoke('scu:passpoint-devices'),
  passpointUser: () => ipcRenderer.invoke('scu:passpoint-user'),
  passpointAdd: (input: { mac: string; expireDays?: number; serviceName?: string }) =>
    ipcRenderer.invoke('scu:passpoint-add', input),
  passpointCancel: (mac: string) => ipcRenderer.invoke('scu:passpoint-cancel', mac),
  jwcNotices: (page = 1) => ipcRenderer.invoke('scu:jwc-notices', page),
  jwcNotice: (url: string) => ipcRenderer.invoke('scu:jwc-notice', url),
  classroomIndex: () => ipcRenderer.invoke('scu:classroom-index'),
  classroomTypes: (input: ScuClassroomTypesInput) =>
    ipcRenderer.invoke('scu:classroom-types', input),
  classroomAvailability: (input: ScuClassroomAvailabilityInput) =>
    ipcRenderer.invoke('scu:classroom-availability', input),
  programColleges: () => ipcRenderer.invoke('scu:program-colleges'),
  programGrades: () => ipcRenderer.invoke('scu:program-grades'),
  programSearch: (input?: ScuProgramSearchInput) =>
    ipcRenderer.invoke('scu:program-search', input ?? {}),
  programDetail: (fajhh: string) => ipcRenderer.invoke('scu:program-detail', fajhh),
  programCourse: (urlPath: string) => ipcRenderer.invoke('scu:program-course', urlPath),
  planCompletion: () => ipcRenderer.invoke('scu:plan-completion'),
  classOptions: () => ipcRenderer.invoke('scu:class-options'),
  classSubjects: (departmentNum: string) => ipcRenderer.invoke('scu:class-subjects', departmentNum),
  classList: (input?: ScuClassListInput) => ipcRenderer.invoke('scu:class-list', input ?? {}),
  classSchedule: (planCode: string, classCode: string) =>
    ipcRenderer.invoke('scu:class-schedule', planCode, classCode),
  courseOptions: () => ipcRenderer.invoke('scu:course-options'),
  courseSearch: (input?: ScuCourseSearchInput) =>
    ipcRenderer.invoke('scu:course-search', input ?? {}),
  courseSchedule: (planCode: string, courseCode: string, courseSeq: string) =>
    ipcRenderer.invoke('scu:course-schedule', planCode, courseCode, courseSeq),
};
