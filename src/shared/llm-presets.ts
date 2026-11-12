/** LLM 提供商预设：只承载默认值，不含密钥；密钥只存在主进程的配置实例里。 */
import type { LlmModelSettings } from './llm';

export const LLM_MODEL_LIMIT = 64;
export const LLM_DEFAULT_CONTEXT_WINDOW = 256000;
export const LLM_DEFAULT_OUTPUT_TOKENS = 128000;

/** 推理档位与当前选择按模型保存。 */
export function llmModelSettings(
  provider: { modelConfigs?: Record<string, LlmModelSettings> },
  model: string,
): LlmModelSettings & { effortLevels: string[] } {
  const settings = provider.modelConfigs?.[model] ?? {};
  const effortLevels = settings.effortLevels ?? [];
  const preferred = settings.effort;
  const effort = preferred && effortLevels.includes(preferred) ? preferred : effortLevels[0];
  return { ...settings, effortLevels, effort };
}
export interface LlmProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** 新建配置的初始模型列表，第一个为默认模型；真实可用模型以「检测」返回为准。 */
  models: string[];
  /** 获取 API Key 的控制台地址；自定义预设没有。 */
  keyUrl?: string;
}

/** 推理强度档位：跨提供商的超集，按强度递增排序。 */
export const reasoningEffortLevels = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;

export const llmProviderPresets: readonly LlmProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    // 官方同时提供对话、推理与快速档；实际可用列表以「检测模型」返回为准。
    models: ['deepseek-v4-pro', 'deepseek-reasoner', 'deepseek-chat', 'deepseek-flash'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.2', 'gpt-5.2-mini', 'gpt-4.1', 'o4-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    // Anthropic 官方提供 OpenAI 兼容入口，可直接走本应用的对话协议。
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    // Gemini 的 OpenAI 兼容前缀。
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3', 'grok-3-mini'],
    keyUrl: 'https://console.x.ai/team/default/api-keys',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.2', 'glm-4.7', 'glm-4.6'],
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'qwen',
    name: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-max', 'qwen3-coder-plus', 'qwen-plus'],
    keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
  },
  {
    id: 'kimi',
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-thinking', 'kimi-k2-turbo-preview', 'moonshot-v1-128k'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
    keyUrl: 'https://platform.minimaxi.com/',
  },
  {
    id: 'zhipu-coding',
    name: '智谱 Coding Plan',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    models: ['glm-5.2', 'glm-4.7'],
    keyUrl: 'https://bigmodel.cn/coding-plan/personal/overview',
  },
  { id: 'custom', name: '自定义', baseUrl: '', models: [] },
];

export function findLlmPreset(id: string | null | undefined): LlmProviderPreset | undefined {
  return llmProviderPresets.find((preset) => preset.id === id);
}
