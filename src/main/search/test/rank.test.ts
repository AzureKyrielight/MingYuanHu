import { describe, expect, it } from 'vitest';
import {
  SEARCH_MAX_TOKENS,
  matchesAllTokens,
  rankByScore,
  splitSearchTokens,
  titleScore,
} from '../rank';

describe('splitSearchTokens', () => {
  it('splits on half-width and full-width spaces, lowercases and dedupes', () => {
    expect(splitSearchTokens('  编译  原理　编译 ')).toEqual(['编译', '原理']);
  });

  it('caps the number of keywords', () => {
    const tokens = splitSearchTokens(Array.from({ length: 20 }, (_, i) => `k${i}`).join(' '));
    expect(tokens).toHaveLength(SEARCH_MAX_TOKENS);
  });

  it('returns an empty list for blank queries', () => {
    expect(splitSearchTokens('   ')).toEqual([]);
  });
});

describe('matchesAllTokens', () => {
  it('requires every keyword to appear', () => {
    expect(matchesAllTokens('编译原理 课程设计', ['编译', '设计'])).toBe(true);
    expect(matchesAllTokens('编译原理 课程设计', ['编译', '报告'])).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(matchesAllTokens('Lecture Notes', ['lecture', 'NOTES'])).toBe(true);
  });

  it('treats an empty keyword list as a match (recent-records mode)', () => {
    expect(matchesAllTokens('任意文本', [])).toBe(true);
  });
});

describe('titleScore', () => {
  it('orders exact, prefix, word-start and substring hits', () => {
    const tokens = ['编译'];
    expect(titleScore('编译', tokens)).toBeGreaterThan(titleScore('编译原理', tokens));
    expect(titleScore('编译原理', tokens)).toBeGreaterThan(titleScore('实验-编译', tokens));
    expect(titleScore('实验-编译', tokens)).toBeGreaterThan(titleScore('高级编译', tokens));
  });

  it('returns zero when nothing matches', () => {
    expect(titleScore('数据结构', ['编译'])).toBe(0);
  });

  it('treats punctuation as a word boundary', () => {
    expect(titleScore('实验-编译', ['编译'])).toBeGreaterThanOrEqual(60);
  });

  it('does not throw on regex-significant characters', () => {
    expect(titleScore('实验(编译)报告', ['(编译)'])).toBeGreaterThan(0);
  });
});

describe('rankByScore', () => {
  it('keeps the original order for equal scores', () => {
    const items = [
      { score: 1, id: 'a' },
      { score: 1, id: 'b' },
    ];
    expect(rankByScore(items, (item) => item.score).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('sorts higher scores first', () => {
    const items = [
      { score: 1, id: 'a' },
      { score: 3, id: 'b' },
      { score: 2, id: 'c' },
    ];
    expect(rankByScore(items, (item) => item.score).map((item) => item.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
});
