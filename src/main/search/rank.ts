/** 全局搜索的查询切分与排序：纯函数，供主进程 SQL 组装与单测共用。 */

/** 最多取 6 个关键词：再多也只是让 SQL 更长，用户实际不会这么搜。 */
export const SEARCH_MAX_TOKENS = 6;

/**
 * 按空白切分查询（全角空格也算），小写化并去重。
 * 空查询返回空数组——调用方据此走「最近记录」而不是加 WHERE 条件。
 */
export function splitSearchTokens(query: string): string[] {
  const tokens: string[] = [];
  for (const raw of query.split(/[\s\u3000]+/u)) {
    const token = raw.trim().toLocaleLowerCase();
    if (!token || tokens.includes(token)) continue;
    tokens.push(token);
    if (tokens.length >= SEARCH_MAX_TOKENS) break;
  }
  return tokens;
}

/** 所有关键词都出现才算命中：先按词收窄，再按标题命中的位置排序。 */
export function matchesAllTokens(text: string, tokens: readonly string[]): boolean {
  const haystack = text.toLocaleLowerCase();
  return tokens.every((token) => haystack.includes(token.toLocaleLowerCase()));
}

const titleScoreExact = 100;
const titleScorePrefix = 80;
const titleScoreWordStart = 60;
const titleScoreIncludes = 40;

/**
 * 标题打分：完全相等 > 前缀 > 词首（空白/标点后的第一个词）> 任意位置命中。
 * 打分只影响同一类结果内部的顺序，不改变是否命中。
 */
export function titleScore(title: string, tokens: readonly string[]): number {
  const haystack = title.toLocaleLowerCase();
  if (!tokens.length) return 0;
  let best = 0;
  for (const token of tokens) {
    if (haystack === token) best = Math.max(best, titleScoreExact);
    else if (haystack.startsWith(token)) best = Math.max(best, titleScorePrefix);
    else if (new RegExp(`(^|[\\s\\-_/.,()（）])${escapeRegExp(token)}`, 'u').test(haystack))
      best = Math.max(best, titleScoreWordStart);
    else if (haystack.includes(token)) best = Math.max(best, titleScoreIncludes);
  }
  return best;
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 稳定排序（同分保持 SQL 给出的顺序），分数为 0 的记录排在最后。 */
export function rankByScore<T>(items: readonly T[], score: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
