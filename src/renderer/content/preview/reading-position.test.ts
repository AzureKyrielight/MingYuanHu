import { describe, expect, it } from 'vitest';
import {
  parsePositions,
  putPosition,
  readingEntriesLimit,
  type PositionMap,
} from './reading-position';

describe('parsePositions', () => {
  it('returns an empty map for missing or broken data', () => {
    expect(parsePositions(null)).toEqual({});
    expect(parsePositions('{oops')).toEqual({});
    expect(parsePositions('[]')).toEqual({});
  });

  it('drops entries with invalid positions but keeps the rest', () => {
    const map = parsePositions(
      JSON.stringify({
        good: { position: 12.5, updatedAt: '2026-11-11T00:00:00.000Z' },
        negative: { position: -1 },
        nan: { position: 'abc' },
        junk: 3,
      }),
    );
    expect(Object.keys(map)).toEqual(['good']);
    expect(map.good?.position).toBe(12.5);
  });

  it('fills a fallback timestamp when updatedAt is missing', () => {
    expect(parsePositions(JSON.stringify({ a: { position: 1 } })).a?.updatedAt).toBe(
      '1970-01-01T00:00:00.000Z',
    );
  });
});

describe('putPosition', () => {
  it('adds and overwrites entries without mutating the input', () => {
    const original = putPosition({}, 'a', 3, '2026-11-11T00:00:00.000Z');
    const next = putPosition(original, 'a', 9, '2026-11-11T01:00:00.000Z');
    expect(original.a?.position).toBe(3);
    expect(next.a?.position).toBe(9);
  });

  it('ignores invalid keys and positions', () => {
    expect(putPosition({}, '', 5, '2026-11-11T00:00:00.000Z')).toEqual({});
    expect(putPosition({}, 'a', Number.NaN, '2026-11-11T00:00:00.000Z')).toEqual({});
  });

  it('keeps only the newest entries when over the limit', () => {
    let map: PositionMap = {};
    for (let index = 0; index < 5; index += 1)
      map = putPosition(map, `doc-${index}`, index, `2026-11-1${index}T00:00:00.000Z`, 3);
    expect(Object.keys(map).sort()).toEqual(['doc-2', 'doc-3', 'doc-4']);
  });

  it('defaults to the shared entry limit', () => {
    expect(readingEntriesLimit).toBe(200);
  });
});
