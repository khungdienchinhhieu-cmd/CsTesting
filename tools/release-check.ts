import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Checker, FORBIDDEN_MARKERS, ROOT, readJson, walkFiles } from './lib.ts';

const strict = !(process.argv.includes('--allow-placeholder') || process.env.ALLOW_PLACEHOLDER === '1');
const c = new Checker(`RELEASE CHECK ${strict ? '(RELEASE)' : '(DEV — chưa chặn placeholder)'}`);

interface Manifest { assets: { id: string; status: string; license: string; budget?: Record<string, number> }[] }
interface SkinFile { skins: { id: string; status: string; palette: string[] }[] }

const manifest = readJson<Manifest>('data/asset_manifest.json');
const skins = readJson<SkinFile>('data/skins/defs.json');
const placeholders = manifest.assets.filter((a) => a.status !== 'final');
if (placeholders.length) {
  const msg = `${placeholders.length} asset còn placeholder: ${placeholders.map((p) => p.id).slice(0, 8).join(', ')}…`;
  if (strict) c.check(false, msg); else c.warn(msg);
}
for (const a of manifest.assets) c.check(a.license.length > 0, `${a.id}: thiếu license`);
for (const s of skins.skins) {
  c.check(s.status !== 'draft', `${s.id}: skin draft không được phát hành`);
  c.check(s.palette.length === 4, `${s.id}: palette thiếu màu`);
}

const flags = ['REAL_MONEY_TOPUP', 'LOOT_BOXES', 'DIRECT_TRADING', 'VOICE_CHAT', 'USER_GENERATED_SKINS'];
for (const f of flags) {
  if (process.env[`FF_${f}`] === 'true') {
    c.check(false, `FF_${f}=true — bắt buộc đọc docs/LEGAL_CHECKLIST.md và xác nhận trước khi bật`);
  }
}
const files = walkFiles(join(ROOT, 'data')).concat(walkFiles(join(ROOT, 'apps')), walkFiles(join(ROOT, 'packages')));
for (const file of files) {
  const lower = file.toLowerCase();
  for (const marker of FORBIDDEN_MARKERS) {
    if (lower.includes(marker.toLowerCase())) c.check(false, `phát hiện từ khoá thương hiệu bị cấm trong đường dẫn: ${file}`);
  }
}
for (const doc of ['docs/LEGAL_CHECKLIST.md', 'docs/ASSET_BRIEF.md', 'docs/ART_BIBLE.md', 'docs/ARCHITECTURE.md', 'PROGRESS.md']) {
  c.check(existsSync(join(ROOT, doc)), `thiếu tài liệu ${doc}`);
}
for (const pkg of ['package.json', 'packages/shared/package.json', 'packages/bots/package.json', 'apps/client/package.json', 'apps/gameserver/package.json', 'apps/api/package.json']) {
  const json = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(pkg);
  for (const [name, version] of Object.entries({ ...json.dependencies, ...json.devDependencies })) {
    c.check(!version.startsWith('^') && !version.startsWith('~') && !version.includes('x'), `${pkg}: ${name} phải ghim phiên bản chính xác (${version})`);
    if (name.startsWith('@tactical/')) c.check(version === 'workspace:*', `${pkg}: ${name} phải dùng workspace:*`);
  }
}
c.check(existsSync(join(ROOT, 'apps/api/migrations/001_init.sql')), 'thiếu migration 001_init.sql');
c.check(existsSync(join(ROOT, 'docker-compose.yml')), 'thiếu docker-compose.yml');
const gitignore = existsSync(join(ROOT, '.gitignore')) ? 'ok' : '';
c.check(gitignore === 'ok', 'thiếu .gitignore');
c.note(`strict=${strict}; placeholder=${placeholders.length}`);
const rc = c.report();
if (rc !== 0) process.exit(rc);
if (strict) {
  // Chạy lại validator dữ liệu/anim/asset như một phần của cổng phát hành.
  for (const tool of ['validate-data.ts', 'validate-anim.ts', 'validate-assets.ts']) {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', join(ROOT, 'tools', tool)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
process.exit(0);
