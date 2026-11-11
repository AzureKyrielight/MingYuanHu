import { describe, expect, it } from 'vitest';
import { normalizeScuMailAddress } from './mail';

describe('normalizeScuMailAddress', () => {
  it('expands a bare student id', () => {
    expect(normalizeScuMailAddress('202312345678')).toBe('202312345678@stu.scu.edu.cn');
  });

  it('inserts a missing @ before the campus domain', () => {
    expect(normalizeScuMailAddress('202312345678stu.scu.edu.cn')).toBe(
      '202312345678@stu.scu.edu.cn',
    );
    expect(normalizeScuMailAddress('teacherscu.edu.cn')).toBe('teacher@scu.edu.cn');
  });

  it('keeps complete addresses and lowercases them', () => {
    expect(normalizeScuMailAddress('Me@Stu.SCU.edu.cn')).toBe('me@stu.scu.edu.cn');
  });

  it('leaves unrelated or empty input untouched', () => {
    expect(normalizeScuMailAddress('name@example.com')).toBe('name@example.com');
    expect(normalizeScuMailAddress('   ')).toBe('');
    expect(normalizeScuMailAddress('abc')).toBe('abc');
  });
});
