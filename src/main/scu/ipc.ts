/** 川大校园服务 IPC。所有请求参数在主进程校验，渲染层只拿到结果或可展示错误。 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  connectScu,
  disconnectScu,
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
  scuState,
  scuUserInfo,
  scuClassroomIndex,
  scuClassroomTypes,
  scuClassroomAvailability,
  scuProgramColleges,
  scuProgramGrades,
  scuProgramSearch,
  scuProgramDetail,
  scuProgramCourse,
  scuPlanCompletion,
  scuClassOptions,
  scuClassSubjects,
  scuClassList,
  scuClassSchedule,
  scuCourseOptions,
  scuCourseSearch,
  scuCourseSchedule,
  resetScuSubsystems,
  scuCloudPrintStatus,
  scuCloudPrintJobs,
  scuJwcNotices,
  scuJwcNotice,
} from './api';
import {
  clearIdentity,
  fetchLoginCaptcha,
  identityState,
  loginWithPassword,
  loginWithPasswordAuto,
} from './identity';

const codeSchema = z.string().trim().min(1);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const textSchema = z.string().trim().max(200).default('');
const optionalTextSchema = z.string().trim().max(200).optional();
const pageSchema = z.number().int().min(1).max(999).default(1);
const pageSizeSchema = z.number().int().min(1).max(200).default(100);
const balanceInputSchema = z
  .object({
    type: z.union([z.literal(1), z.literal(2)]),
    schoolCode: codeSchema.optional(),
    regCode: codeSchema.optional(),
    unitCode: codeSchema.optional(),
    room: codeSchema.optional(),
  })
  .strict();

export function registerScuIpc(): void {
  ipcMain.handle('scu:connect', (event) => connectScu(event.sender));
  ipcMain.handle('scu:disconnect', () => disconnectScu());
  ipcMain.handle('scu:state', () => scuState());
  ipcMain.handle('scu:identity-state', () => identityState());
  ipcMain.handle('scu:identity-captcha', () => fetchLoginCaptcha());
  ipcMain.handle('scu:identity-login', async (_event, input: unknown) => {
    const state = await loginWithPassword(
      z
        .object({
          username: z.string().trim().min(6).max(32),
          password: z.string().min(1).max(256),
          captchaCode: z.string().min(1).max(256),
          captchaText: z.string().trim().min(1).max(32),
        })
        .strict()
        .parse(input),
    );
    resetScuSubsystems();
    return state;
  });
  ipcMain.handle('scu:identity-logout', () => {
    clearIdentity();
    resetScuSubsystems();
    return identityState();
  });
  ipcMain.handle('scu:identity-login-auto', async (_event, input: unknown) => {
    const state = await loginWithPasswordAuto(
      z
        .object({
          username: z.string().trim().min(6).max(32),
          password: z.string().min(1).max(256),
        })
        .strict()
        .parse(input),
    );
    resetScuSubsystems();
    return state;
  });
  ipcMain.handle('scu:user-info', () => scuUserInfo());
  ipcMain.handle('scu:semesters', () => scuSemesters());
  ipcMain.handle('scu:grades', (_event, scheme: unknown) =>
    scuGrades(z.boolean().default(false).parse(scheme)),
  );
  ipcMain.handle('scu:exams', () => scuExams());
  ipcMain.handle('scu:balance-campus', () => scuBalanceCampus());
  ipcMain.handle('scu:balance-buildings', (_event, schoolCode: unknown) =>
    scuBalanceBuildings(codeSchema.parse(schoolCode)),
  );
  ipcMain.handle('scu:balance-units', (_event, schoolCode: unknown, regCode: unknown) =>
    scuBalanceUnits(codeSchema.parse(schoolCode), codeSchema.parse(regCode)),
  );
  ipcMain.handle('scu:balance-query', (_event, input: unknown) =>
    scuBalanceQuery(balanceInputSchema.parse(input)),
  );
  ipcMain.handle('scu:balance-trend', (_event, type: unknown, days: unknown) =>
    scuBalanceTrend(
      z
        .union([z.literal(1), z.literal(2)])
        .default(1)
        .parse(type),
      z.number().int().min(0).max(3650).default(0).parse(days),
    ),
  );
  ipcMain.handle('scu:fitness-notices', () => scuFitnessNotices());
  ipcMain.handle('scu:fitness-score', (_event, year: unknown) =>
    scuFitnessScore(
      z.number().int().min(2000).max(2100).default(new Date().getFullYear()).parse(year),
    ),
  );
  ipcMain.handle('scu:card-transactions', (_event, sdate: unknown, edate: unknown) =>
    scuCardTransactions(
      z
        .union([dateSchema, z.literal('')])
        .default('')
        .parse(sdate),
      z
        .union([dateSchema, z.literal('')])
        .default('')
        .parse(edate),
    ),
  );
  ipcMain.handle('scu:service-applications', (_event, status: unknown, page: unknown) =>
    scuServiceApplications(
      z.number().int().min(0).max(3).default(0).parse(status),
      z.number().int().min(1).max(999).default(1).parse(page),
    ),
  );
  ipcMain.handle('scu:cloudprint-status', () => scuCloudPrintStatus());
  ipcMain.handle('scu:cloudprint-jobs', () => scuCloudPrintJobs());
  ipcMain.handle('scu:jwc-notices', (_event, page: unknown) =>
    scuJwcNotices(z.number().int().min(1).max(20).default(1).parse(page)),
  );
  ipcMain.handle('scu:jwc-notice', (_event, url: unknown) =>
    scuJwcNotice(
      z
        .string()
        .regex(/^https:\/\/jwc\.scu\.edu\.cn\/info\/\d+\/\d+\.htm$/)
        .parse(url),
    ),
  );

  ipcMain.handle('scu:classroom-index', () => scuClassroomIndex());
  ipcMain.handle('scu:classroom-types', (_event, input: unknown) =>
    scuClassroomTypes(
      z
        .object({
          campusNumber: codeSchema,
          buildingNumber: codeSchema,
          campusName: textSchema,
          buildingName: textSchema,
        })
        .strict()
        .parse(input),
    ),
  );
  ipcMain.handle('scu:classroom-availability', (_event, input: unknown) =>
    scuClassroomAvailability(
      z
        .object({
          campusNumber: codeSchema,
          buildingNumber: codeSchema,
          classroomType: textSchema,
          classroomName: textSchema,
          seatFrom: textSchema,
          seatTo: textSchema,
          date: z.union([dateSchema, z.literal('')]).default(''),
        })
        .strict()
        .parse(input),
    ),
  );
  ipcMain.handle('scu:program-colleges', () => scuProgramColleges());
  ipcMain.handle('scu:program-grades', () => scuProgramGrades());
  ipcMain.handle('scu:program-search', (_event, input: unknown) =>
    scuProgramSearch(
      z
        .object({ college: optionalTextSchema, grade: optionalTextSchema })
        .strict()
        .default({})
        .parse(input ?? {}),
    ),
  );
  ipcMain.handle('scu:program-detail', (_event, fajhh: unknown) =>
    scuProgramDetail(codeSchema.parse(fajhh)),
  );
  ipcMain.handle('scu:program-course', (_event, urlPath: unknown) =>
    scuProgramCourse(
      z
        .string()
        .trim()
        .min(1)
        .max(1000)
        .refine((value) => value.startsWith('/'))
        .parse(urlPath),
    ),
  );
  ipcMain.handle('scu:plan-completion', () => scuPlanCompletion());
  ipcMain.handle('scu:class-options', () => scuClassOptions());
  ipcMain.handle('scu:class-subjects', (_event, departmentNum: unknown) =>
    scuClassSubjects(codeSchema.parse(departmentNum)),
  );
  ipcMain.handle('scu:class-list', (_event, input: unknown) =>
    scuClassList(
      z
        .object({
          plan: optionalTextSchema,
          year: optionalTextSchema,
          department: optionalTextSchema,
          subject: optionalTextSchema,
          classNum: optionalTextSchema,
          page: pageSchema.optional(),
          pageSize: pageSizeSchema.optional(),
        })
        .strict()
        .default({})
        .parse(input ?? {}),
    ),
  );
  ipcMain.handle('scu:class-schedule', (_event, planCode: unknown, classCode: unknown) =>
    scuClassSchedule(codeSchema.parse(planCode), codeSchema.parse(classCode)),
  );
  ipcMain.handle('scu:course-options', () => scuCourseOptions());
  ipcMain.handle('scu:course-search', (_event, input: unknown) =>
    scuCourseSearch(
      z
        .object({
          semester: optionalTextSchema,
          department: optionalTextSchema,
          name: optionalTextSchema,
          code: optionalTextSchema,
          seq: optionalTextSchema,
          category: optionalTextSchema,
          page: pageSchema.optional(),
          pageSize: pageSizeSchema.optional(),
        })
        .strict()
        .default({})
        .parse(input ?? {}),
    ),
  );
  ipcMain.handle(
    'scu:course-schedule',
    (_event, planCode: unknown, courseCode: unknown, courseSeq: unknown) =>
      scuCourseSchedule(
        codeSchema.parse(planCode),
        codeSchema.parse(courseCode),
        codeSchema.parse(courseSeq),
      ),
  );
}
