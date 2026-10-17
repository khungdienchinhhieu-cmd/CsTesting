import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Checker, FORBIDDEN_MARKERS, ROOT, readJson } from './lib.ts';

const c = new Checker('VALIDATE ASSETS — manifest & cổng chất lượng');
interface Asset { id: string; type: string; path: string; source: string; author: string; license: string; aiGenerated: boolean; status: string; hero: boolean; budget?: Record<string, number>; notes?: string }
interface Manifest { version: number; assets: Asset[] }

const manifest = readJson<Manifest>('data/asset_manifest.json');
const ids = new Set<string>();
let placeholders = 0, heroes = 0;
for (const a of manifest.assets) {
  c.check(!ids.has(a.id), `trùng asset id ${a.id}`);
  ids.add(a.id);
  c.check(a.author.trim().length > 0, `${a.id}: thiếu author`);
  c.check(['project-original', 'cc0', 'cc-by-4.0', 'commissioned'].includes(a.license), `${a.id}: license ${a.license} chưa được duyệt`);
  c.check(['procedural', 'commissioned', 'cc0-library', 'ai-assisted'].includes(a.source), `${a.id}: source lạ ${a.source}`);
  c.check(['placeholder', 'final'].includes(a.status), `${a.id}: status lạ`);
  if (a.status === 'placeholder') placeholders++;
  if (a.hero) heroes++;
  if (a.source === 'ai-assisted') c.check(a.aiGenerated, `${a.id}: source ai-assisted phải khai aiGenerated=true`);
  if (a.source !== 'procedural') {
    const p = join(ROOT, a.path);
    c.check(existsSync(p), `${a.id}: không tìm thấy file ${a.path}`);
  }
  for (const marker of FORBIDDEN_MARKERS) {
    c.check(!`${a.id} ${a.notes ?? ''}`.toLowerCase().includes(marker.toLowerCase()), `${a.id}: chứa từ khoá thương hiệu bị cấm`);
  }
  if (a.type !== 'audio') {
    const tri = a.budget?.triangles;
    c.check(tri === undefined || (tri > 0 && tri <= 500_000), `${a.id}: ngân sách tam giác không hợp lệ`);
  }
  if (a.type === 'map' || a.type === 'character' || a.type === 'weapon_viewmodel') {
    c.check((a.budget?.triangles ?? 0) > 0, `${a.id}: thiếu budget.triangles`);
  }
  const tex = a.budget?.textureMax;
  if (tex !== undefined && tex > 0) c.check((tex & (tex - 1)) === 0, `${a.id}: textureMax ${tex} không phải luỹ thừa 2`);
  if (a.status === 'placeholder' && !/PLACEHOLDER/i.test(a.notes ?? '')) c.warn(`${a.id}: placeholder nhưng notes không ghi PLACEHOLDER`);
}
c.check(manifest.assets.length > 0, 'manifest rỗng');
c.note(`${manifest.assets.length} asset, ${placeholders} placeholder, ${heroes} hero`);
if (placeholders > 0) c.warn(`${placeholders} asset chưa đạt cổng chất lượng — release thật sẽ bị chặn (xem docs/ASSET_BRIEF.md)`);
process.exit(c.report());
