import { describe, expect, it } from 'vitest';
import { canvasTodoStatus, nextTodoDue, todoCompleted, todoReminderDue } from './todo';

describe('Canvas 作业完成事实', () => {
  it('缺少提交数据不猜测未完成', () => {
    expect(canvasTodoStatus({})).toBe('unknown');
    expect(todoCompleted('unknown')).toBe(false);
  });
  it('有成绩或零分不等于已提交', () => {
    expect(
      canvasTodoStatus({ submission: { workflow_state: 'graded', score: 0, submitted_at: null } }),
    ).toBe('pending');
  });
  it('已提交、待批阅与已批改分别展示', () => {
    expect(canvasTodoStatus({ submission: { workflow_state: 'submitted' } })).toBe('submitted');
    expect(canvasTodoStatus({ submission: { workflow_state: 'pending_review' } })).toBe(
      'submitted',
    );
    expect(
      canvasTodoStatus({
        submission: { workflow_state: 'graded', submitted_at: '2026-09-21T00:00:00Z' },
      }),
    ).toBe('graded');
  });
  it('教师要求重交时不能继续显示完成', () => {
    const status = canvasTodoStatus({
      submission: { redo_request: true, submitted_at: '2026-09-21T00:00:00Z' },
    });
    expect(status).toBe('resubmit');
    expect(todoCompleted(status)).toBe(false);
  });
  it('豁免与线下作业独立展示', () => {
    expect(canvasTodoStatus({ submission: { excused: true } })).toBe('excused');
    expect(
      canvasTodoStatus({
        submission_types: ['on_paper'],
        submission: { workflow_state: 'unsubmitted' },
      }),
    ).toBe('offline');
  });
});

describe('待办重复规则', () => {
  it('按天、按周推进并保留时分', () => {
    expect(nextTodoDue('2026-03-09T23:59:00.000Z', 'daily')).toBe('2026-03-10T23:59:00.000Z');
    expect(nextTodoDue('2026-03-09T23:59:00.000Z', 'weekly')).toBe('2026-03-16T23:59:00.000Z');
  });

  it('按月推进时把日期钳到目标月最后一天', () => {
    expect(nextTodoDue('2026-01-31T08:00:00.000Z', 'monthly')).toBe('2026-02-28T08:00:00.000Z');
    expect(nextTodoDue('2028-01-31T08:00:00.000Z', 'monthly')).toBe('2028-02-29T08:00:00.000Z');
    expect(nextTodoDue('2026-03-15T08:00:00.000Z', 'monthly')).toBe('2026-04-15T08:00:00.000Z');
  });

  it('非法时间返回 null 而不是抛出', () => {
    expect(nextTodoDue('不是时间', 'daily')).toBeNull();
  });
});

describe('待办提醒', () => {
  const now = Date.parse('2026-03-09T09:00:00.000Z');

  it('到点且未完成才算到期', () => {
    expect(todoReminderDue({ remindAt: '2026-03-09T08:59:00.000Z', status: 'pending' }, now)).toBe(
      true,
    );
    expect(todoReminderDue({ remindAt: '2026-03-09T09:01:00.000Z', status: 'pending' }, now)).toBe(
      false,
    );
    expect(
      todoReminderDue({ remindAt: '2026-03-09T08:00:00.000Z', status: 'completed' }, now),
    ).toBe(false);
  });

  it('没有提醒时间或时间非法时不提醒', () => {
    expect(todoReminderDue({ remindAt: null, status: 'pending' }, now)).toBe(false);
    expect(todoReminderDue({ remindAt: '坏时间', status: 'pending' }, now)).toBe(false);
  });
});
