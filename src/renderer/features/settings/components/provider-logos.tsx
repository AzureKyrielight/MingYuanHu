/**
 * 模型厂商图标：24×24 单色标记，用 currentColor 着色，跟随深浅主题变化。
 * 图形来自 @lobehub/icons-static-svg（MIT 许可）并已随包内联，运行时不会请求网络。
 */
import chatglm from '../../../assets/providers/chatglm.svg?raw';
import claude from '../../../assets/providers/claude.svg?raw';
import deepseek from '../../../assets/providers/deepseek.svg?raw';
import gemini from '../../../assets/providers/gemini.svg?raw';
import grok from '../../../assets/providers/grok.svg?raw';
import kimi from '../../../assets/providers/kimi.svg?raw';
import minimax from '../../../assets/providers/minimax.svg?raw';
import openai from '../../../assets/providers/openai.svg?raw';
import qwen from '../../../assets/providers/qwen.svg?raw';
import { cn } from '../../../lib/utils';

const logos: Record<string, string> = {
  chatglm,
  claude,
  deepseek,
  gemini,
  grok,
  kimi,
  minimax,
  openai,
  qwen,
};

export type ProviderLogoId = keyof typeof logos;

/** 预设 id / 别名 → 图标 id；自定义预设没有图标。 */
const presetLogos: Record<string, ProviderLogoId> = {
  deepseek: 'deepseek',
  openai: 'openai',
  anthropic: 'claude',
  claude: 'claude',
  google: 'gemini',
  gemini: 'gemini',
  xai: 'grok',
  grok: 'grok',
  zhipu: 'chatglm',
  glm: 'chatglm',
  'zhipu-coding': 'chatglm',
  qwen: 'qwen',
  dashscope: 'qwen',
  tongyi: 'qwen',
  kimi: 'kimi',
  moonshot: 'kimi',
  minimax: 'minimax',
};

/** 名称关键词兜底：自定义（presetId 为空）的提供商也能认出常见厂商。 */
const nameLogos: [RegExp, ProviderLogoId][] = [
  [/deepseek|深度求索/i, 'deepseek'],
  [/openai|chatgpt|gpt/i, 'openai'],
  [/anthropic|claude/i, 'claude'],
  [/gemini|google|bard/i, 'gemini'],
  [/grok|\bxai\b/i, 'grok'],
  [/glm|zhipu|bigmodel|智谱/i, 'chatglm'],
  [/qwen|通义|千问|dashscope|阿里/i, 'qwen'],
  [/kimi|moonshot|月之暗面/i, 'kimi'],
  [/minimax|abab/i, 'minimax'],
];

/** 找提供商对应的图标 id：先看预设，再按名称识别，都没有返回 null。 */
export function providerLogoId(
  presetId: string | null | undefined,
  name?: string | null,
): ProviderLogoId | null {
  if (presetId && presetLogos[presetId]) return presetLogos[presetId];
  if (!name) return null;
  return nameLogos.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export function ProviderLogo({
  id,
  className,
}: {
  id: ProviderLogoId | null | undefined;
  className?: string;
}) {
  const svg = id ? logos[id] : undefined;
  if (!svg) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center [&>svg]:size-full',
        className,
      )}
      // 内容是随包打包的静态 SVG 资源，不含外部输入。
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
