// 终端快捷命令：存在 workspace_settings 里的一个小 JSON 数组。
// 只保存命令文本，不保存任何执行结果；写入用 zod 逐条校验，坏数据整表回退为空。
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TerminalQuickCommand } from '../../shared/terminal';
import { readSetting, writeSetting } from '../settings/prefs';

export const quickCommandInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(40),
  command: z.string().trim().min(1).max(500),
});

const quickCommandsSchema = z.array(
  z.object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(40),
    command: z.string().min(1).max(500),
  }),
);

const settingKey = 'terminal-quick-commands';

/** 读取失败（未设置、JSON 损坏、条目不合法）一律视为空列表。 */
export function getQuickCommands(): TerminalQuickCommand[] {
  const raw = readSetting(settingKey);
  if (!raw) return [];
  try {
    return quickCommandsSchema.catch([]).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persist(items: TerminalQuickCommand[]): TerminalQuickCommand[] {
  writeSetting(settingKey, JSON.stringify(items));
  return items;
}

/** 新增或按 id 覆盖；同名命令不合并，用户显式保存两次就是两条。 */
export function saveQuickCommand(input: unknown): TerminalQuickCommand[] {
  const value = quickCommandInputSchema.parse(input);
  const items = getQuickCommands();
  if (value.id) {
    const index = items.findIndex((item) => item.id === value.id);
    if (index === -1) throw new Error('快捷命令不存在');
    items[index] = { id: value.id, label: value.label, command: value.command };
    return persist(items);
  }
  return persist([...items, { id: randomUUID(), label: value.label, command: value.command }]);
}

export function removeQuickCommand(id: unknown): TerminalQuickCommand[] {
  const target = z.string().min(1).max(64).parse(id);
  return persist(getQuickCommands().filter((item) => item.id !== target));
}
