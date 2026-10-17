import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'data');

export function readJson<T = unknown>(rel: string): T {
  const path = rel.startsWith('/') ? rel : join(ROOT, rel);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export class Checker {
  errors: string[] = [];
  warnings: string[] = [];
  notes: string[] = [];
  readonly title: string;
  constructor(title: string) { this.title = title; }

  check(cond: unknown, message: string): boolean {
    if (!cond) this.errors.push(message);
    return !!cond;
  }
  warn(message: string): void { this.warnings.push(message); }
  note(message: string): void { this.notes.push(message); }

  report(): number {
    const line = '─'.repeat(64);
    console.log(`\n${line}\n${this.title}\n${line}`);
    if (this.notes.length) console.log(this.notes.map((n) => `  · ${n}`).join('\n'));
    if (this.warnings.length) console.log(this.warnings.map((w) => `  ! ${w}`).join('\n'));
    if (this.errors.length) {
      console.log(this.errors.map((e) => `  ✗ ${e}`).join('\n'));
      console.log(`\nKẾT QUẢ: THẤT BẠI (${this.errors.length} lỗi, ${this.warnings.length} cảnh báo)`);
      return 1;
    }
    console.log(`KẾT QUẢ: ĐẠT (${this.notes.length} ghi chú, ${this.warnings.length} cảnh báo)`);
    return 0;
  }
}

export interface MapJson {
  id: string;
  name: string;
  description?: string;
  layout: string[];
  cellSize: number;
  origin: [number, number, number];
  spawns: Record<'T' | 'CT', [number, number, number][]>;
  sites: { id: 'A' | 'B'; name: string; rect: [number, number, number, number]; center: [number, number, number] }[];
  buyZones: Record<'T' | 'CT', [number, number, number, number][]>;
  callouts: { name: string; rect: [number, number, number, number] }[];
  lights?: unknown[];
  environment?: { theme?: string };
}

export function walkable(ch: string): boolean {
  return ch !== '#' && ch !== 'x' && ch !== 'X' && ch !== 'h';
}

export function mapCells(map: MapJson): { width: number; height: number; at: (c: number, r: number) => string } {
  const width = map.layout[0]?.length ?? 0;
  const height = map.layout.length;
  return {
    width, height,
    at: (c, r) => (c < 0 || r < 0 || c >= width || r >= height ? '#' : map.layout[r]![c] ?? '#'),
  };
}

export function worldToCell(map: MapJson, x: number, z: number): [number, number] {
  return [Math.floor((x - map.origin[0]) / map.cellSize), Math.floor((z - map.origin[2]) / map.cellSize)];
}

/** BFS 4 hướng trên lưới đi được; trả về tập ô tiếp cận. */
export function reachable(map: MapJson, start: [number, number]): Set<string> {
  const cells = mapCells(map);
  const seen = new Set<string>();
  const [sc, sr] = start;
  if (!walkable(cells.at(sc, sr))) return seen;
  const queue: [number, number][] = [[sc, sr]];
  seen.add(`${sc},${sr}`);
  while (queue.length) {
    const [c, r] = queue.pop()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc, nr = r + dr;
      const key = `${nc},${nr}`;
      if (seen.has(key)) continue;
      if (!walkable(cells.at(nc, nr))) continue;
      seen.add(key);
      queue.push([nc, nr]);
    }
  }
  return seen;
}

export function fileSize(path: string): number {
  const p = path.startsWith('/') ? path : join(ROOT, path);
  return existsSync(p) ? statSync(p).size : -1;
}

export function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSafe(dir)) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      walkFiles(p, out);
    } else if (/\.(ts|tsx|json|md|css|html|sql|yml|yaml)$/.test(entry.name)) out.push(p);
  }
  return out;
}

import { readdirSync } from 'node:fs';
function readdirSafe(dir: string): { name: string; isDirectory: () => boolean }[] {
  return readdirSync(dir, { withFileTypes: true });
}

/** Từ khoá thương hiệu bị cấm, ghép chuỗi để chính mã nguồn không chứa nguyên văn. */
export const FORBIDDEN_MARKERS: string[] = [
  ['Counter', 'Strike'].join('-'),
  ['C', 'S', '2'].join(''),
  ['Val', 've'].join(''),
  ['Half', 'Life'].join('-'),
  ['Source', '2'].join(' '),
  ['Dust', 'II'].join(' '),
  ['Nu', 'ke'].join(''),
  ['Mira', 'ge'].join(''),
  ['Infer', 'no'].join(''),
];
