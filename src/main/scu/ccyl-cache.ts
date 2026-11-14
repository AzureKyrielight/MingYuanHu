import { app } from 'electron';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ScuCcylSnapshot, ScuResult } from '../../shared/scu';
import { identityState } from './identity';
import { scuCcylLibrary, scuCcylMine, scuCcylSearch } from './api';

const fields = [
  'id',
  'activityId',
  'activityLibraryId',
  'name',
  'title',
  'activityName',
  'orgName',
  'organizationName',
  'startTime',
  'activityTime',
  'status',
  'enrollStartTime',
  'enrollEndTime',
] as const;
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rowSchema = z.record(z.string(), scalar);
const snapshotSchema = z.object({
  key: z.string(),
  syncedAt: z.string().datetime(),
  data: z.union([
    z.array(rowSchema),
    z.object({ activities: z.array(rowSchema), subscribed: z.boolean() }),
  ]),
});
const storeSchema = z.array(snapshotSchema).max(40);
let generation = 0;

export function resetCcylCacheSession(): void {
  generation += 1;
}

function cachePath(principal: string): string {
  const hash = createHash('sha256').update(principal).digest('hex');
  return join(app.getPath('userData'), `scu-ccyl-cache-${hash}.json`);
}

function readStore(principal: string): z.infer<typeof storeSchema> {
  try {
    return storeSchema.parse(JSON.parse(readFileSync(cachePath(principal), 'utf8')));
  } catch {
    return [];
  }
}

function projectRow(raw: unknown): Record<string, string | number | boolean | null> {
  const value = z.record(z.string(), z.unknown()).parse(raw);
  const activity =
    value.activity && typeof value.activity === 'object'
      ? z.record(z.string(), z.unknown()).parse(value.activity)
      : value;
  const row: Record<string, string | number | boolean | null> = {};
  for (const field of fields) {
    const parsed = scalar.safeParse(activity[field] ?? value[field]);
    if (parsed.success)
      row[field] = typeof parsed.data === 'string' ? parsed.data.slice(0, 1000) : parsed.data;
  }
  return row;
}

export async function scuCcylSnapshot(input: {
  kind: 'search' | 'mine' | 'library';
  name?: string;
  id?: string;
  offline?: boolean;
}): Promise<ScuResult<ScuCcylSnapshot>> {
  const principal = identityState().principal;
  if (!principal) return { ok: false, auth: true, error: '请先登录以确认缓存所属账号' };
  const epoch = generation;
  const key = JSON.stringify([
    input.kind,
    input.kind === 'search' ? (input.name ?? '') : input.kind === 'library' ? input.id : '',
  ]);
  const previous = readStore(principal).find((entry) => entry.key === key);
  if (input.offline) {
    return previous
      ? { ok: true, data: { ...previous, offline: true } }
      : { ok: false, auth: false, error: '此查询尚无本地缓存，请先联网刷新' };
  }
  const response =
    input.kind === 'search'
      ? await scuCcylSearch({ name: input.name ?? '', page: 1 })
      : input.kind === 'mine'
        ? await scuCcylMine(1)
        : await scuCcylLibrary(input.id!);
  if (identityState().principal !== principal || epoch !== generation)
    return { ok: false, auth: true, error: '账号状态已变化，请重新查询' };
  if (!response.ok) return response;
  try {
    const data =
      input.kind === 'library'
        ? (() => {
            const detail = z
              .object({ activities: z.array(z.unknown()), subscribed: z.boolean() })
              .parse(response.data);
            return { activities: detail.activities.map(projectRow), subscribed: detail.subscribed };
          })()
        : z.array(z.unknown()).parse(response.data).map(projectRow);
    const entry = { key, syncedAt: new Date().toISOString(), data };
    let persisted = true;
    try {
      const entries = readStore(principal).filter((item) => item.key !== key);
      const path = cachePath(principal);
      writeFileSync(`${path}.tmp`, JSON.stringify([...entries, entry].slice(-40)), 'utf8');
      renameSync(`${path}.tmp`, path);
    } catch {
      persisted = false;
    }
    return { ok: true, data: { ...entry, offline: false, persisted } };
  } catch {
    return { ok: false, auth: false, error: '第二课堂数据格式无法识别，未更新缓存' };
  }
}

export function clearCcylCache(): ScuResult<null> {
  const principal = identityState().principal;
  if (!principal) return { ok: false, auth: true, error: '请先登录以确认缓存所属账号' };
  resetCcylCacheSession();
  try {
    rmSync(cachePath(principal), { force: true });
    return { ok: true, data: null };
  } catch {
    return { ok: false, auth: false, error: '无法清除本地缓存，请稍后重试' };
  }
}
