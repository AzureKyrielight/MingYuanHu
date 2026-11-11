import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = new Map<string, string>();
vi.mock('../../settings/prefs', () => ({
  readSetting: (key: string) => settings.get(key),
  writeSetting: (key: string, value: string) => void settings.set(key, value),
}));

import { getQuickCommands, removeQuickCommand, saveQuickCommand } from '../quick-commands';

beforeEach(() => settings.clear());

describe('终端快捷命令', () => {
  it('saves with a generated id and lists in insertion order', () => {
    saveQuickCommand({ label: '状态', command: 'git status' });
    saveQuickCommand({ label: '日志', command: 'git log --oneline -5' });
    const items = getQuickCommands();
    expect(items.map((item) => item.label)).toEqual(['状态', '日志']);
    expect(items[0]?.id).toBeTruthy();
  });

  it('updates an existing command by id', () => {
    const [first] = saveQuickCommand({ label: '状态', command: 'git status' });
    saveQuickCommand({ id: first!.id, label: '状态', command: 'git status -s' });
    expect(getQuickCommands()).toEqual([
      { id: first!.id, label: '状态', command: 'git status -s' },
    ]);
  });

  it('rejects unknown ids instead of silently appending', () => {
    expect(() => saveQuickCommand({ id: 'missing', label: 'x', command: 'y' })).toThrow(
      '快捷命令不存在',
    );
  });

  it('removes by id and ignores unknown ids', () => {
    const [first] = saveQuickCommand({ label: '状态', command: 'git status' });
    removeQuickCommand('not-there');
    expect(getQuickCommands()).toHaveLength(1);
    removeQuickCommand(first!.id);
    expect(getQuickCommands()).toEqual([]);
  });

  it('falls back to an empty list when stored JSON is broken', () => {
    settings.set('terminal-quick-commands', '{not json');
    expect(getQuickCommands()).toEqual([]);
    settings.set('terminal-quick-commands', JSON.stringify([{ id: '1' }]));
    expect(getQuickCommands()).toEqual([]);
  });

  it('trims surrounding whitespace and rejects blank input', () => {
    const [first] = saveQuickCommand({ label: ' 状态 ', command: '  git status  ' });
    expect(first).toMatchObject({ label: '状态', command: 'git status' });
    expect(() => saveQuickCommand({ label: '  ', command: 'git status' })).toThrow();
    expect(() => saveQuickCommand({ label: '状态', command: '   ' })).toThrow();
  });
});
