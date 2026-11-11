/** 电费余额趋势：查询成功后本地记录快照，按北京日历日聚合计算日均消耗。
 *  计算规则移植自 SCU-CLI（internal/api/balance_trend.go）。 */
import { getDatabase } from '../database';
import type { ScuBalanceDailyPoint, ScuBalanceTrend } from '../../shared/scu';

export interface ScuBalanceRecord {
  readonly roomKey: string;
  readonly balanceType: 1 | 2;
  readonly timestamp: number;
  readonly balance: number;
  readonly price: number;
}

export type { ScuBalanceDailyPoint, ScuBalanceTrend };

const HISTORY_KEY = 'scu-balance-history';
const MAX_RECORDS = 2000;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

function readHistory(): ScuBalanceRecord[] {
  try {
    const row = getDatabase()
      .prepare('SELECT value FROM workspace_settings WHERE key=?')
      .get(HISTORY_KEY) as { value: string } | undefined;
    const parsed: unknown = row ? JSON.parse(row.value) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ScuBalanceRecord => {
      const value = item as Partial<ScuBalanceRecord> | null;
      return (
        typeof value?.timestamp === 'number' &&
        typeof value.balance === 'number' &&
        (value.balanceType === 1 || value.balanceType === 2)
      );
    });
  } catch {
    return [];
  }
}

function writeHistory(records: readonly ScuBalanceRecord[]): void {
  const cutoff = Date.now() - RETENTION_MS;
  const kept = records
    .filter((record) => record.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_RECORDS);
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(HISTORY_KEY, JSON.stringify(kept));
}

/** 余额解析失败时跳过，避免把 0 写进历史污染趋势。 */
export function recordBalanceSnapshot(roomKey: string, balanceType: 1 | 2, info: unknown): void {
  const data = info as { balance?: unknown; price?: unknown } | null;
  const balance = Number(data?.balance);
  if (!Number.isFinite(balance)) return;
  const price = Number(data?.price);
  writeHistory([
    ...readHistory(),
    {
      roomKey,
      balanceType,
      timestamp: Date.now(),
      balance,
      price: Number.isFinite(price) ? price : 0,
    },
  ]);
}

export function roomKeyOf(binding: {
  schoolCode: string;
  regCode: string;
  unitCode: string;
  roomNo: string;
}): string {
  return [binding.schoolCode, binding.regCode, binding.unitCode, binding.roomNo].join('_');
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingDayKey(timestamp: number): string {
  return new Date(timestamp + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

export function calculateBalanceTrend(records: readonly ScuBalanceRecord[]): ScuBalanceTrend {
  if (records.length === 0) {
    return {
      dailyPoints: [],
      dailyAvgCost: 0,
      dailyAvgKwh: 0,
      totalCost: 0,
      totalKwh: 0,
      totalDays: 0,
      skippedRechargeSegments: 0,
      recordCount: 0,
      firstRecordAt: null,
      lastRecordAt: null,
      currentPrice: 0,
    };
  }
  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);
  const daily = new Map<string, ScuBalanceRecord>();
  for (const record of sorted) {
    const key = beijingDayKey(record.timestamp);
    const existing = daily.get(key);
    if (!existing || record.timestamp > existing.timestamp) daily.set(key, record);
  }
  const dailyPoints = [...daily.entries()]
    .map(([day, record]) => ({
      day,
      timestamp: record.timestamp,
      balance: record.balance,
      price: record.price,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  let totalCost = 0;
  let totalKwh = 0;
  let totalDays = 0;
  let skippedRechargeSegments = 0;
  for (let i = 0; i + 1 < dailyPoints.length; i += 1) {
    const a = dailyPoints[i]!;
    const b = dailyPoints[i + 1]!;
    const days = (b.timestamp - a.timestamp) / 86_400_000;
    if (days <= 0) continue;
    const delta = a.balance - b.balance;
    if (delta < 0) {
      skippedRechargeSegments += 1;
      continue;
    }
    totalCost += delta * ((a.price + b.price) / 2);
    totalKwh += delta;
    totalDays += days;
  }
  return {
    dailyPoints,
    dailyAvgCost: totalDays > 0 ? totalCost / totalDays : 0,
    dailyAvgKwh: totalDays > 0 ? totalKwh / totalDays : 0,
    totalCost,
    totalKwh,
    totalDays,
    skippedRechargeSegments,
    recordCount: sorted.length,
    firstRecordAt: new Date(sorted[0]!.timestamp).toISOString(),
    lastRecordAt: new Date(sorted.at(-1)!.timestamp).toISOString(),
    currentPrice: dailyPoints.at(-1)!.price,
  };
}

/** 读取某类电费的趋势；days>0 时只统计最近 N 天。 */
export function balanceTrend(balanceType: 1 | 2, days = 0): ScuBalanceTrend {
  const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0;
  return calculateBalanceTrend(
    readHistory().filter(
      (record) => record.balanceType === balanceType && record.timestamp >= cutoff,
    ),
  );
}
