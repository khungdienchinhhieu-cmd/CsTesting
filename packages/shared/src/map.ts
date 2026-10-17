import { CollisionWorld, makeCollider, type Collider } from './collision';

export interface MapSite { id: 'A' | 'B'; rect: [number, number, number, number]; center: [number, number, number] }
export interface Callout { name: string; rect: [number, number, number, number]; minimapColor?: string }
export interface MapEnvironment {
  skyColor: string; horizonColor: string; sunColor: string; sunDirection: [number, number, number];
  ambientColor: string; fogColor: string; fogDensity: number; exposure: number; groundColor: string; theme: string;
}
export interface MapProp { kind: string; x: number; y: number; z: number; rot: number; scale: number }
export interface MapJson {
  id: string; name: string; version: number; description?: string;
  cellSize: number; origin: [number, number, number];
  layout: string[];
  bounds: [number, number, number, number, number, number];
  spawns: { T: [number, number, number][]; CT: [number, number, number][] };
  sites: MapSite[];
  buyZones: { T: [number, number, number, number][]; CT: [number, number, number, number][] };
  callouts: Callout[];
  environment: MapEnvironment;
  lights: { type: string; direction?: [number, number, number]; color: string; intensity: number }[];
  props: MapProp[];
}

export type MapCell = '#' | '.' | 'T' | 'C' | 'A' | 'B' | 'b' | 'x' | 'X' | 'h' | 'P';

export class GameMap {
  readonly json: MapJson;
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly originX: number;
  readonly originZ: number;
  readonly cells: Uint8Array;
  readonly colliders: Collider[];
  readonly collision: CollisionWorld;
  readonly wallHeight = 4.2;

  constructor(json: MapJson) {
    if (!json.layout.length) throw new Error(`[map] ${json.id} không có layout`);
    this.json = json;
    this.width = json.layout[0]!.length;
    this.height = json.layout.length;
    this.cellSize = json.cellSize;
    this.originX = json.origin[0];
    this.originZ = json.origin[2];
    this.cells = new Uint8Array(this.width * this.height);
    for (let r = 0; r < this.height; r++) {
      const row = json.layout[r]!;
      if (row.length !== this.width) throw new Error(`[map] ${json.id} hàng ${r} dài ${row.length}, cần ${this.width}`);
      for (let c = 0; c < this.width; c++) this.cells[r * this.width + c] = row.charCodeAt(c);
    }
    this.colliders = buildColliders(this);
    this.collision = new CollisionWorld(this.colliders);
  }

  cellAt(c: number, r: number): string {
    if (c < 0 || r < 0 || c >= this.width || r >= this.height) return '#';
    return String.fromCharCode(this.cells[r * this.width + c]!);
  }
  isWalkableCell(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= this.width || r >= this.height) return false;
    const ch = this.cellAt(c, r);
    return ch !== '#' && ch !== 'x' && ch !== 'X' && ch !== 'h';
  }
  cellCenter(c: number, r: number): [number, number] {
    return [this.originX + (c + 0.5) * this.cellSize, this.originZ + (r + 0.5) * this.cellSize];
  }
  worldToCell(x: number, z: number): [number, number] {
    return [
      Math.floor((x - this.originX) / this.cellSize),
      Math.floor((z - this.originZ) / this.cellSize),
    ];
  }
  cellAtWorld(x: number, z: number): string {
    const [c, r] = this.worldToCell(x, z);
    return this.cellAt(c, r);
  }
  isWalkableWorld(x: number, z: number): boolean {
    const [c, r] = this.worldToCell(x, z);
    return this.isWalkableCell(c, r);
  }
  floorHeightAt(x: number, z: number): number {
    if (this.cellAtWorld(x, z) === 'P') return 0.35;
    return 0;
  }
  calloutAt(x: number, z: number): string {
    for (const co of this.json.callouts) {
      const [x1, z1, x2, z2] = co.rect;
      if (x >= x1 && x <= x2 && z >= z1 && z <= z2) return co.name;
    }
    return 'Unknown';
  }
  siteAt(x: number, z: number): 'A' | 'B' | null {
    for (const s of this.json.sites) {
      const [x1, z1, x2, z2] = s.rect;
      if (x >= x1 && x <= x2 && z >= z1 && z <= z2) return s.id;
    }
    return null;
  }
  inBuyZone(team: 'T' | 'CT', x: number, z: number): boolean {
    for (const [x1, z1, x2, z2] of this.json.buyZones[team]) {
      if (x >= x1 && x <= x2 && z >= z1 && z <= z2) return true;
    }
    return false;
  }
  spawn(team: 'T' | 'CT', index: number): [number, number, number] {
    const list = this.json.spawns[team];
    return list[index % list.length]!;
  }
}

function buildColliders(map: GameMap): Collider[] {
  const out: Collider[] = [];
  const { cellSize, originX, originZ, width, height } = map;
  const wallH = map.wallHeight;
  const wallMat = map.json.environment?.theme === 'industrial' ? 'concrete' : 'sandstone';
  // Sàn
  out.push(makeCollider('floor', [originX, -1, originZ], [originX + width * cellSize, 0, originZ + height * cellSize],
    wallMat, { solid: false, walkable: true, blocksSight: false, blocksBullets: true, penetration: 0 }));
  // Tường: gộp mỗi hàng thành đoạn ngang
  for (let r = 0; r < height; r++) {
    let start = -1;
    for (let c = 0; c <= width; c++) {
      const isWall = map.cellAt(c, r) === '#';
      if (isWall && start < 0) start = c;
      if ((!isWall || c === width) && start >= 0) {
        const x1 = originX + start * cellSize, x2 = originX + c * cellSize;
        out.push(makeCollider(`wall_r${r}_c${start}`, [x1, 0, originZ + r * cellSize], [x2, wallH, originZ + (r + 1) * cellSize],
          wallMat, { walkable: false, blocksSight: true, blocksBullets: true, penetration: 0 }));
        start = -1;
      }
    }
  }
  // Vật cản trong map
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const ch = map.cellAt(c, r);
      if (ch !== 'x' && ch !== 'X' && ch !== 'h' && ch !== 'P') continue;
      const x1 = originX + c * cellSize, z1 = originZ + r * cellSize;
      const x2 = x1 + cellSize, z2 = z1 + cellSize;
      if (ch === 'P') {
        out.push(makeCollider(`platform_${c}_${r}`, [x1, 0, z1], [x2, 0.35, z2],
          'metal', { solid: true, walkable: true, blocksSight: false, blocksBullets: true, penetration: 0.2 }));
      } else if (ch === 'h') {
        out.push(makeCollider(`half_${c}_${r}`, [x1, 0, z1], [x2, 1.05, z2],
          'concrete', { walkable: false, blocksSight: false, blocksBullets: true, penetration: 0.15 }));
      } else if (ch === 'x') {
        out.push(makeCollider(`crate_${c}_${r}`, [x1 + 0.1, 0, z1 + 0.1], [x2 - 0.1, 0.95, z2 - 0.1],
          'wood', { walkable: true, blocksSight: false, blocksBullets: true, penetration: 0.35 }));
      } else {
        out.push(makeCollider(`crate_tall_${c}_${r}`, [x1 + 0.05, 0, z1 + 0.05], [x2 - 0.05, 1.9, z2 - 0.05],
          'metal', { walkable: true, blocksSight: true, blocksBullets: true, penetration: 0.1 }));
      }
    }
  }
  return out;
}

export function parseMap(json: MapJson): GameMap { return new GameMap(json); }
