// 设置 › 内置能力：Pi 内置工具的开关。停用名单存 workspace_settings('tools-disabled')，
// 新建会话时作为 excludeTools 交给 Pi；read/write/edit/bash 是 agent 最小工具集，不可关闭。
// 联网搜索与读取网页默认开启：未配置搜索服务时搜索会回退到免密钥的必应网页版，
// 用户想关掉时在设置里关即可。
import { z } from 'zod';
import type { AgentCapabilityView } from '../../shared/capabilities';
import { getDatabase } from '../database';

const KEY = 'tools-disabled';
// 旧版本默认停用 web_search（当时要求用户自备搜索服务）。该值在 workspace_settings 里
// 与「用户手动只关了 web_search」无法区分，因此用标记位只迁移一次。
const LEGACY_DEFAULT = ['web_search'];
const LEGACY_MARKER = 'tools-disabled-version';
const LEGACY_MARKER_VALUE = '2';
const DEFAULT_DISABLED: string[] = [];

const tools: Omit<AgentCapabilityView, 'enabled'>[] = [
  {
    name: 'read',
    label: '读取文件',
    description: '读取文件与图片',
    domain: 'core',
    domainLabel: '基础',
  },
  {
    name: 'write',
    label: '写入文件',
    description: '创建或覆盖文件',
    domain: 'core',
    domainLabel: '基础',
  },
  {
    name: 'edit',
    label: '编辑文件',
    description: '精确替换文件中的文本',
    domain: 'core',
    domainLabel: '基础',
  },
  {
    name: 'bash',
    label: '执行命令',
    description:
      process.platform === 'darwin'
        ? '在 Bash 中执行命令（含 dela 校园命令）'
        : '在 Git Bash 中执行命令（含 dela 校园命令）',
    domain: 'core',
    domainLabel: '基础',
  },
  {
    name: 'grep',
    label: '搜索内容',
    description: '按内容搜索文件（ripgrep）',
    domain: 'search',
    domainLabel: '搜索',
  },
  {
    name: 'find',
    label: '查找文件',
    description: '按文件名模式查找文件',
    domain: 'search',
    domainLabel: '搜索',
  },
  {
    name: 'ls',
    label: '列出目录',
    description: '列出目录内容',
    domain: 'search',
    domainLabel: '搜索',
  },
  {
    name: 'web_search',
    label: '联网搜索',
    description: '联网搜索；未配置搜索服务时自动使用免密钥的必应网页版',
    domain: 'web',
    domainLabel: '网络',
  },
  {
    name: 'web_fetch',
    label: '读取网页',
    description: '读取网页；PDF 直链交给文档读取 Skill（需安装组件）',
    domain: 'web',
    domainLabel: '网络',
  },
  {
    name: 'task',
    label: '派发子 Agent',
    description: '派出上下文独立的子 Agent 并行处理子任务，可在后台运行',
    domain: 'subagent',
    domainLabel: '子 Agent',
  },
].map((tool) =>
  ['read', 'write', 'edit', 'bash'].includes(tool.name)
    ? { ...tool, lockedReason: 'Agent 最小工具集，不可关闭' }
    : tool,
);

export function readDisabledTools(): Set<string> {
  migrateLegacyDefault();
  const row = getDatabase().prepare('SELECT value FROM workspace_settings WHERE key=?').get(KEY) as
    { value: string } | undefined;
  const parsed = z.array(z.string()).safeParse(row ? JSON.parse(row.value) : DEFAULT_DISABLED);
  const names = new Set(tools.filter((tool) => !tool.lockedReason).map((tool) => tool.name));
  return new Set((parsed.success ? parsed.data : []).filter((name) => names.has(name)));
}

/** 一次性迁移：旧版本把 web_search 写进了默认停用名单（那时它必须自备搜索服务才能用），
 *  升级后它已能免密钥回退，所以把「还是旧默认值」的名单清空；用户改过的不动。 */
function migrateLegacyDefault() {
  const db = getDatabase();
  const marked = db.prepare('SELECT value FROM workspace_settings WHERE key=?').get(LEGACY_MARKER);
  if (marked) return;
  const row = db.prepare('SELECT value FROM workspace_settings WHERE key=?').get(KEY) as
    { value: string } | undefined;
  let isLegacyDefault = false;
  if (row) {
    try {
      const parsed = z.array(z.string()).safeParse(JSON.parse(row.value));
      isLegacyDefault =
        parsed.success &&
        parsed.data.length === LEGACY_DEFAULT.length &&
        LEGACY_DEFAULT.every((name) => parsed.data.includes(name));
    } catch {
      isLegacyDefault = false;
    }
  }
  db.exec('BEGIN');
  try {
    if (isLegacyDefault) db.prepare('DELETE FROM workspace_settings WHERE key=?').run(KEY);
    db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
      LEGACY_MARKER,
      LEGACY_MARKER_VALUE,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function writeDisabledTools(names: Set<string>) {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(KEY, JSON.stringify([...names]));
}

export function listBuiltinCapabilities(): AgentCapabilityView[] {
  const disabled = readDisabledTools();
  return tools.map((tool) => ({ ...tool, enabled: !disabled.has(tool.name) }));
}

export function setBuiltinCapabilities(names: string[], enabled: boolean): AgentCapabilityView[] {
  const disabled = readDisabledTools();
  for (const name of names) {
    const tool = tools.find((item) => item.name === name);
    if (!tool) throw new Error(`能力不存在：${name}`);
    if (tool.lockedReason) continue;
    if (enabled) disabled.delete(name);
    else disabled.add(name);
  }
  writeDisabledTools(disabled);
  return listBuiltinCapabilities();
}

export function domainTools(domain: string): string[] {
  return tools.filter((tool) => tool.domain === domain).map((tool) => tool.name);
}
