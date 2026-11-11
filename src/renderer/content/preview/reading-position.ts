// 阅读位置持久化：Map<tabId, { position, updatedAt }> 存 localStorage。
// 纯函数负责解析/裁剪，读写函数负责与 localStorage 打交道，便于单测与浏览器预览降级。

export interface StoredPosition {
  /** PDF 是「页索引 + 页内比例」，其他预览是像素 scrollTop，读的一方各自解释。 */
  position: number;
  updatedAt: string;
}

export type PositionMap = Record<string, StoredPosition>;

export const readingStorageKey = 'dela.reading-positions';
/** 最多记住 200 份文档：再多也只是把 localStorage 当缓存用，没有意义。 */
export const readingEntriesLimit = 200;

/** 旧数据、坏 JSON、非对象一律视为空表，不让一条坏记录影响整个阅读体验。 */
export function parsePositions(raw: string | null | undefined): PositionMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const map: PositionMap = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as { position?: unknown; updatedAt?: unknown };
    const position = typeof entry.position === 'number' ? entry.position : Number.NaN;
    if (!Number.isFinite(position) || position < 0) continue;
    map[key] = {
      position,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString(),
    };
  }
  return map;
}

/** 写入一条位置并按 updatedAt 裁掉最旧的记录（返回新对象，不修改入参）。 */
export function putPosition(
  map: PositionMap,
  key: string,
  position: number,
  updatedAt: string,
  limit = readingEntriesLimit,
): PositionMap {
  if (!key || !Number.isFinite(position) || position < 0) return map;
  const next: PositionMap = { ...map, [key]: { position, updatedAt } };
  const keys = Object.keys(next);
  if (keys.length <= limit) return next;
  const keep = keys
    .sort((a, b) => (next[b]?.updatedAt ?? '').localeCompare(next[a]?.updatedAt ?? ''))
    .slice(0, Math.max(1, limit));
  const trimmed: PositionMap = {};
  for (const entry of keep) {
    const value = next[entry];
    if (value) trimmed[entry] = value;
  }
  return trimmed;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 隐私模式/被禁用时访问 localStorage 会抛错。
    return null;
  }
}

export function readPositions(): PositionMap {
  return parsePositions(storage()?.getItem(readingStorageKey));
}

export function readPosition(key: string): number {
  return readPositions()[key]?.position ?? 0;
}

export function savePosition(key: string, position: number, now = new Date()): void {
  const store = storage();
  if (!store) return;
  const next = putPosition(readPositions(), key, position, now.toISOString());
  try {
    store.setItem(readingStorageKey, JSON.stringify(next));
  } catch {
    // 配额满等情况忽略：阅读位置丢失不该中断阅读。
  }
}
