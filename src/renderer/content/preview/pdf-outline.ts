// PDF 大纲（书签）拍平成可点击列表：pdf.js 的 getOutline 返回嵌套结构，
// 界面只关心「标题 + 层级 + 跳转目标」，这里把嵌套展平并做防御性校验。

export interface OutlineNode {
  title?: unknown;
  dest?: unknown;
  items?: readonly OutlineNode[] | null;
}

export interface OutlineEntry {
  /** 稳定的 React key：位置 + 标题（大纲里可能有同名条目）。 */
  id: string;
  title: string;
  depth: number;
  dest: unknown;
}

/** 超过这个数量的大纲基本是自动生成的目录，全部渲染只会拖慢打开速度。 */
export const outlineEntryLimit = 400;

export function flattenOutline(nodes: readonly OutlineNode[] | null | undefined): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  if (!Array.isArray(nodes)) return entries;
  const walk = (list: readonly OutlineNode[], depth: number) => {
    for (const node of list) {
      if (entries.length >= outlineEntryLimit) return;
      if (!node || typeof node !== 'object') continue;
      const title = typeof node.title === 'string' ? node.title.trim() : '';
      // 没有跳转目标的条目（分节标题）单独出现时点了也没反应，直接跳过。
      if (title && node.dest != null)
        entries.push({ id: `${entries.length}:${title}`, title, depth, dest: node.dest });
      if (Array.isArray(node.items)) walk(node.items, depth + 1);
    }
  };
  walk(nodes, 0);
  return entries;
}
