import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ranh giới bot', () => {
  it('chỉ import bot-api, không chạm mô phỏng/server', () => {
    const dir = join(__dirname, '../../packages/bots/src');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const imp of imports) {
        if (imp === '@tactical/shared') bad.push(`${f}: import toàn bộ shared`);
        if (imp.includes('apps/') || imp.includes('match') || imp.includes('MatchSim')) bad.push(`${f}: ${imp}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
