import { z } from 'zod';
import { querySchedule, refreshSemesterStart } from '../../../timetable/api';
import { coverage, freshness, tool } from '../shared';

const semesterPattern = /^\d{4}-\d{4}-[12]-\d+$/;
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式为 YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    );
  }, '日期不存在');

const queryScheduleInput = z
  .object({
    semester: z.string().regex(semesterPattern).optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasDates = value.startDate !== undefined || value.endDate !== undefined;
    const hasTimes = value.startAt !== undefined || value.endAt !== undefined;
    if (hasDates && hasTimes) {
      ctx.addIssue({ code: 'custom', message: '日期对与 UTC 时间对不能混用，请只提供一组' });
      return;
    }
    if (!hasDates && !hasTimes) {
      ctx.addIssue({
        code: 'custom',
        message:
          '请提供 startDate/endDate（YYYY-MM-DD，按上海时区解释，推荐）或 startAt/endAt（UTC ISO 8601）',
      });
      return;
    }
    if (hasDates) {
      if (value.startDate === undefined || value.endDate === undefined) {
        ctx.addIssue({ code: 'custom', message: 'startDate 与 endDate 必须成对提供' });
      } else if (value.endDate < value.startDate) {
        ctx.addIssue({ code: 'custom', message: 'endDate 不能早于 startDate' });
      }
    } else if (value.startAt === undefined || value.endAt === undefined) {
      ctx.addIssue({ code: 'custom', message: 'startAt 与 endAt 必须成对提供' });
    }
  });

/** YYYY-MM-DD 按上海时区（UTC+8）转 UTC ISO：start 为当日 00:00，end 为次日 00:00（含结束日全天）。 */
function shanghaiDayToUtc(date: string, edge: 'start' | 'end'): string {
  const [year, month, day] = date.split('-').map(Number);
  const utcMillis = Date.UTC(year!, month! - 1, day!) + (edge === 'end' ? 86400000 : 0);
  return new Date(utcMillis - 8 * 3600000).toISOString();
}

export const queryScheduleTool = tool(
  '查询时间范围内的课程与个人事件（只读本地缓存，按 Asia/Shanghai 展开周次）。优先传 startDate/endDate（YYYY-MM-DD，按上海时区解释为当日全天）；也可传 startAt/endAt（UTC ISO 8601）。semester 可选（川大 planCode，格式 YYYY-YYYY-[12]-N），缺省按本机时钟取当前学期。学期未同步或缺学期开始日期时 coverage 带警告；课程与个人事件以 source 字段区分。',
  queryScheduleInput,
  (input) => {
    const startAt =
      input.startDate !== undefined ? shanghaiDayToUtc(input.startDate, 'start') : input.startAt!;
    const endAt =
      input.endDate !== undefined ? shanghaiDayToUtc(input.endDate, 'end') : input.endAt!;
    // 开学日期缺失时先尝试用教务当前教学周补齐（未登录会静默失败），
    // 这样 Agent 不必等用户先进课表页设置。
    const result = refreshSemesterStart(input.semester)
      .catch(() => null)
      .then(() =>
        querySchedule({
          ...(input.semester ? { semester: input.semester } : {}),
          startAt,
          endAt,
        }),
      );
    return result.then((resolved) => {
      // 强化未同步警告：给出可执行的下一步，而不只是陈述缺口。
      const warnings = resolved.coverage.warnings.map((warning) =>
        warning === '该学期课表尚未同步'
          ? '该学期课表尚未同步，请提示用户到课表页面点击同步'
          : warning === '缺少学期开始日期，无法将课程转换为实际日期'
            ? '缺少学期开始日期：请提示用户到课表页点「设置开学日期」，或先在「校园服务」完成统一认证登录后重试'
            : warning,
      );
      return {
        semester: resolved.semester,
        timezone: resolved.timezone,
        items: resolved.items,
        freshness: freshness('cached', resolved.coverage.courseSyncedAt ?? undefined),
        coverage: coverage(
          `cached_lessons_and_events:${resolved.semester}`,
          resolved.coverage.complete,
          warnings,
        ),
      };
    });
  },
);
