import { describe, expect, it } from 'vitest';
import { calculateBalanceTrend, type ScuBalanceRecord } from '../balance-trend';

const DAY = 86_400_000;
// 2026-03-01T04:00:00Z = 北京 12:00，避免落在日界上。
const BASE = Date.UTC(2026, 2, 1, 4, 0, 0);

function record(dayOffset: number, balance: number, price = 0.5): ScuBalanceRecord {
  return {
    roomKey: '1_101_1_101',
    balanceType: 1,
    timestamp: BASE + dayOffset * DAY,
    balance,
    price,
  };
}

describe('calculateBalanceTrend', () => {
  it('无记录时返回空结果', () => {
    const trend = calculateBalanceTrend([]);
    expect(trend.recordCount).toBe(0);
    expect(trend.dailyPoints).toEqual([]);
    expect(trend.dailyAvgCost).toBe(0);
    expect(trend.firstRecordAt).toBeNull();
  });

  it('同一北京日只保留最后一条作为日代表点', () => {
    const trend = calculateBalanceTrend([
      record(0, 10),
      { ...record(0, 9), timestamp: BASE + 60_000 },
      record(1, 8),
    ]);
    expect(trend.recordCount).toBe(3);
    expect(trend.dailyPoints.map((point) => point.balance)).toEqual([9, 8]);
    expect(trend.dailyPoints[0]!.day).toBe('2026-03-01');
  });

  it('按段加权计算日均消耗，并跳过充值段', () => {
    const trend = calculateBalanceTrend([
      record(0, 10, 0.5),
      record(1, 8, 0.5), // 消耗 2 元 / 1 天
      record(2, 12, 0.5), // 余额上升 = 充值，跳过
      record(4, 8, 0.5), // 消耗 4 元 / 2 天
    ]);
    expect(trend.skippedRechargeSegments).toBe(1);
    expect(trend.totalKwh).toBe(6);
    expect(trend.totalCost).toBe(3);
    expect(trend.totalDays).toBe(3);
    expect(trend.dailyAvgCost).toBeCloseTo(1);
    expect(trend.dailyAvgKwh).toBeCloseTo(2);
    expect(trend.currentPrice).toBe(0.5);
    expect(trend.firstRecordAt).toBe(new Date(BASE).toISOString());
    expect(trend.lastRecordAt).toBe(new Date(BASE + 4 * DAY).toISOString());
  });

  it('记录乱序也能按时间排序', () => {
    const trend = calculateBalanceTrend([record(2, 6), record(0, 10), record(1, 8)]);
    expect(trend.dailyPoints.map((point) => point.balance)).toEqual([10, 8, 6]);
    expect(trend.dailyAvgCost).toBeCloseTo(1);
  });
});
