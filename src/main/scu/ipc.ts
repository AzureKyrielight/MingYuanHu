/** 川大校园服务 IPC。所有请求参数在主进程校验，渲染层只拿到结果或可展示错误。 */
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type WebContents } from 'electron';
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
  scuCloudPrintUpload,
  scuJwcNotices,
  scuJwcNotice,
  scuServiceForm,
  scuServiceAttach,
  scuServiceSubmit,
  scuCcylSearch,
  scuCcylMine,
  scuCcylOrdered,
  scuCcylLibrary,
  scuCcylActivity,
  scuCcylScoreTypes,
  scuCcylSignUp,
  scuCcylCancel,
  scuCcylSubscribe,
  scuCcylUnsubscribe,
  scuCcylCredits,
  scuCcylExport,
  scuCcylOrgs,
  scuRepairAddresses,
  scuRepairAreas,
  scuRepairProjects,
  scuRepairBookDates,
  scuRepairBookTimes,
  scuRepairTickets,
  scuRepairWithdraw,
  scuRepairEvaluateProjects,
  scuRepairEvaluate,
  scuRepairSubmit,
  scuPasspointDevices,
  scuPasspointUser,
  scuPasspointAdd,
  scuPasspointCancel,
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

/** 报修图片路径白名单：只有系统文件选择框返回过的路径才允许上传。 */
const approvedRepairImages = new Set<string>();

/** 有窗口时挂在窗口上（模态），否则退化为无父窗口对话框。 */
function openFiles(sender: WebContents, options: OpenDialogOptions) {
  const parent = BrowserWindow.fromWebContents(sender);
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}

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

  // ─── 办事大厅动态表单 ──────────────────────────────────────────
  ipcMain.handle('scu:service-form', (_event, appId: unknown) =>
    scuServiceForm(codeSchema.parse(appId)),
  );
  ipcMain.handle('scu:service-attach', async (event, appId: unknown) => {
    const id = codeSchema.parse(appId);
    const picked = await openFiles(event.sender, {
      title: '选择要上传的附件',
      properties: ['openFile', 'multiSelections'],
    });
    if (picked.canceled || picked.filePaths.length === 0)
      return { ok: true as const, data: [] as unknown[] };
    return scuServiceAttach(id, picked.filePaths);
  });
  ipcMain.handle('scu:service-submit', (_event, appId: unknown, values: unknown) =>
    scuServiceSubmit(
      codeSchema.parse(appId),
      z.record(z.string(), z.unknown()).parse(values ?? {}),
    ),
  );

  // ─── 第二课堂 ──────────────────────────────────────────────────
  ipcMain.handle('scu:ccyl-search', (_event, input: unknown) =>
    scuCcylSearch(
      z
        .object({
          page: z.number().int().min(1).max(999).optional(),
          name: optionalTextSchema,
          level: optionalTextSchema,
          scoreType: optionalTextSchema,
          org: optionalTextSchema,
          status: optionalTextSchema,
        })
        .strict()
        .default({})
        .parse(input ?? {}),
    ),
  );
  ipcMain.handle('scu:ccyl-mine', (_event, page: unknown) =>
    scuCcylMine(z.number().int().min(1).max(999).default(1).parse(page)),
  );
  ipcMain.handle('scu:ccyl-ordered', (_event, page: unknown, name: unknown) =>
    scuCcylOrdered(
      z.number().int().min(1).max(999).default(1).parse(page),
      optionalTextSchema.parse(name) ?? '',
    ),
  );
  ipcMain.handle('scu:ccyl-library', (_event, id: unknown) => scuCcylLibrary(codeSchema.parse(id)));
  ipcMain.handle('scu:ccyl-activity', (_event, id: unknown) =>
    scuCcylActivity(codeSchema.parse(id)),
  );
  ipcMain.handle('scu:ccyl-score-types', (_event, id: unknown) =>
    scuCcylScoreTypes(codeSchema.parse(id)),
  );
  ipcMain.handle('scu:ccyl-signup', (_event, activityId: unknown, scoreType: unknown) =>
    scuCcylSignUp(
      codeSchema.parse(activityId),
      z.string().trim().max(64).default('').parse(scoreType),
    ),
  );
  ipcMain.handle('scu:ccyl-cancel', (_event, id: unknown) => scuCcylCancel(codeSchema.parse(id)));
  ipcMain.handle('scu:ccyl-subscribe', (_event, id: unknown) =>
    scuCcylSubscribe(codeSchema.parse(id)),
  );
  ipcMain.handle('scu:ccyl-unsubscribe', (_event, id: unknown) =>
    scuCcylUnsubscribe(codeSchema.parse(id)),
  );
  ipcMain.handle('scu:ccyl-credits', (_event, page: unknown) =>
    scuCcylCredits(z.number().int().min(1).max(999).default(1).parse(page)),
  );
  ipcMain.handle('scu:ccyl-export', (_event, ids: unknown, email: unknown) =>
    scuCcylExport(
      z.array(z.string().trim().min(1).max(64)).max(200).parse(ids),
      z.string().email().max(128).parse(email),
    ),
  );
  ipcMain.handle('scu:ccyl-orgs', () => scuCcylOrgs());

  // ─── 在线报修 ──────────────────────────────────────────────────
  ipcMain.handle('scu:repair-addresses', () => scuRepairAddresses());
  ipcMain.handle('scu:repair-areas', () => scuRepairAreas());
  ipcMain.handle('scu:repair-projects', (_event, areaId: unknown) =>
    scuRepairProjects(codeSchema.parse(areaId)),
  );
  ipcMain.handle('scu:repair-book-dates', () => scuRepairBookDates());
  ipcMain.handle('scu:repair-book-times', (_event, date: unknown) =>
    scuRepairBookTimes(dateSchema.parse(date)),
  );
  ipcMain.handle('scu:repair-tickets', (_event, userId: unknown) =>
    scuRepairTickets(codeSchema.parse(userId)),
  );
  ipcMain.handle('scu:repair-withdraw', (_event, id: unknown) =>
    scuRepairWithdraw(codeSchema.parse(id)),
  );
  ipcMain.handle('scu:repair-evaluate-projects', () => scuRepairEvaluateProjects());
  ipcMain.handle('scu:repair-evaluate', (_event, input: unknown) =>
    scuRepairEvaluate(
      z
        .object({
          repairId: codeSchema,
          stars: z.record(z.string(), z.number().int().min(1).max(5)),
          content: optionalTextSchema,
        })
        .strict()
        .parse(input),
    ),
  );
  ipcMain.handle('scu:repair-pick-images', async (event) => {
    const picked = await openFiles(event.sender, {
      title: '选择现场照片（最多 3 张）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif'] }],
    });
    if (picked.canceled) return { ok: true as const, data: [] as string[] };
    const files = picked.filePaths.slice(0, 3);
    for (const file of files) approvedRepairImages.add(file);
    return { ok: true as const, data: files };
  });
  ipcMain.handle('scu:repair-submit', (_event, input: unknown) => {
    const parsed = z
      .object({
        addressId: codeSchema,
        projectId: codeSchema,
        content: z.string().trim().min(1).max(2000),
        bookDate: z.union([dateSchema, z.literal('')]).optional(),
        bookTime: optionalTextSchema,
        allowAbsent: z.boolean().optional(),
        images: z.array(z.string().min(1).max(1024)).max(3).optional(),
      })
      .strict()
      .parse(input);
    // 只接受本窗口通过选择框授权的图片路径，防止渲染层传入任意路径。
    const images = (parsed.images ?? []).filter((path) => approvedRepairImages.has(path));
    return scuRepairSubmit({ ...parsed, images });
  });

  // ─── 无感认证 ──────────────────────────────────────────────────
  ipcMain.handle('scu:passpoint-devices', () => scuPasspointDevices());
  ipcMain.handle('scu:passpoint-user', () => scuPasspointUser());
  ipcMain.handle('scu:passpoint-add', (_event, input: unknown) =>
    scuPasspointAdd(
      z
        .object({
          mac: z.string().trim().min(11).max(32),
          expireDays: z.number().int().min(0).max(365).optional(),
          serviceName: optionalTextSchema,
        })
        .strict()
        .parse(input),
    ),
  );
  ipcMain.handle('scu:passpoint-cancel', (_event, mac: unknown) =>
    scuPasspointCancel(z.string().trim().min(11).max(32).parse(mac)),
  );

  // ─── 云打印上传 ────────────────────────────────────────────────
  ipcMain.handle('scu:cloudprint-upload', async (event, options: unknown) => {
    const parsed = z
      .object({
        color: z.enum(['bw', 'color']),
        paper: z.enum(['a4', 'a3', 'original']),
        duplex: z.enum(['simplex', 'long-edge', 'short-edge']),
        copies: z.number().int().min(1).max(999),
        pages: z.string().trim().min(1).max(16),
      })
      .strict()
      .parse(options);
    const picked = await openFiles(event.sender, {
      title: '选择要打印的文件',
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0])
      return { ok: false as const, error: '已取消选择文件', auth: false };
    return scuCloudPrintUpload(picked.filePaths[0], parsed);
  });
}
