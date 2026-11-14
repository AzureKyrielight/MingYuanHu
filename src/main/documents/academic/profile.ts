import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { academicProfileSchema, type AcademicProfile } from './draft';

// 个人信息单独存在用户主目录，只在主进程读取：生成封面时本地填入，不必经过模型上下文。

export function academicProfilePath(home: string): string {
  return join(home, '.dela', 'academic-profile.json');
}

export function readAcademicProfile(path: string): AcademicProfile {
  if (!existsSync(path)) return {};
  return academicProfileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeAcademicProfile(path: string, profile: AcademicProfile): AcademicProfile {
  const merged = { ...readAcademicProfile(path), ...profile };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}
