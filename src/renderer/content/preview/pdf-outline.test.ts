import { describe, expect, it } from 'vitest';
import { flattenOutline, outlineEntryLimit, type OutlineNode } from './pdf-outline';

describe('flattenOutline', () => {
  it('flattens nested entries with depth', () => {
    const outline: OutlineNode[] = [
      { title: '第一章', dest: ['page', 1], items: [{ title: '1.1 小节', dest: ['page', 2] }] },
      { title: '第二章', dest: ['page', 9] },
    ];
    expect(flattenOutline(outline).map(({ title, depth }) => ({ title, depth }))).toEqual([
      { title: '第一章', depth: 0 },
      { title: '1.1 小节', depth: 1 },
      { title: '第二章', depth: 0 },
    ]);
  });

  it('skips entries without a title or destination but still walks children', () => {
    const outline: OutlineNode[] = [
      { title: '  ', dest: ['page', 1] },
      { title: '无目标' },
      { title: '有子项', items: [{ title: '子项', dest: ['page', 3] }] },
    ];
    expect(flattenOutline(outline).map((entry) => entry.title)).toEqual(['子项']);
  });

  it('returns an empty list for missing or malformed outlines', () => {
    expect(flattenOutline(null)).toEqual([]);
    expect(flattenOutline(undefined)).toEqual([]);
  });

  it('caps very large outlines', () => {
    const outline: OutlineNode[] = Array.from({ length: outlineEntryLimit + 20 }, (_, index) => ({
      title: `条目 ${index}`,
      dest: ['page', index],
    }));
    expect(flattenOutline(outline)).toHaveLength(outlineEntryLimit);
  });
});
