import type { GameMap } from './map';
import type { Vec3 } from './math';

/** Lưới điều hướng + A* trên map. Dùng chung cho bot và server. */
export class NavGrid {
  readonly map: GameMap;
  readonly width: number;
  readonly height: number;
  private walkable: Uint8Array;
  private gScore: Float32Array;
  private fScore: Float32Array;
  private cameFrom: Int32Array;
  private closed: Uint8Array;
  private openStamp: Uint32Array;
  private closedStamp: Uint32Array;
  private stamp = 1;
  private heap: Int32Array;
  private heapSize = 0;

  constructor(map: GameMap) {
    this.map = map;
    this.width = map.width;
    this.height = map.height;
    const n = this.width * this.height;
    this.walkable = new Uint8Array(n);
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        this.walkable[r * this.width + c] = map.isWalkableCell(c, r) ? 1 : 0;
      }
    }
    this.gScore = new Float32Array(n);
    this.fScore = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.openStamp = new Uint32Array(n);
    this.closedStamp = new Uint32Array(n);
    this.heap = new Int32Array(n + 1);
  }

  index(c: number, r: number): number { return r * this.width + c; }
  isWalkable(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.width && r < this.height && this.walkable[r * this.width + c] === 1;
  }
  nearestWalkableCell(c: number, r: number, maxRadius = 6): [number, number] {
    if (this.isWalkable(c, r)) return [c, r];
    for (let rad = 1; rad <= maxRadius; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
          if (this.isWalkable(c + dc, r + dr)) return [c + dc, r + dr];
        }
      }
    }
    return [c, r];
  }

  private heapPush(node: number): void {
    let i = this.heapSize++;
    this.heap[i] = node;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.fScore[this.heap[parent]!]! <= this.fScore[this.heap[i]!]!) break;
      const tmp = this.heap[parent]!; this.heap[parent] = this.heap[i]!; this.heap[i] = tmp;
      i = parent;
    }
  }
  private heapPop(): number {
    const top = this.heap[0]!;
    this.heapSize--;
    if (this.heapSize > 0) {
      this.heap[0] = this.heap[this.heapSize]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let smallest = i;
        if (l < this.heapSize && this.fScore[this.heap[l]!]! < this.fScore[this.heap[smallest]!]!) smallest = l;
        if (r < this.heapSize && this.fScore[this.heap[r]!]! < this.fScore[this.heap[smallest]!]!) smallest = r;
        if (smallest === i) break;
        const tmp = this.heap[i]!; this.heap[i] = this.heap[smallest]!; this.heap[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }

  private heuristic(a: number, b: number): number {
    const ac = a % this.width, ar = (a / this.width) | 0;
    const bc = b % this.width, br = (b / this.width) | 0;
    const dx = Math.abs(ac - bc), dz = Math.abs(ar - br);
    return (Math.max(dx, dz) + 0.4142 * Math.min(dx, dz)) * this.map.cellSize;
  }

  /** A*; trả về số điểm, ghi vào out (tái sử dụng). */
  findPath(sx: number, sz: number, gx: number, gz: number, out: Vec3[], maxNodes = 20000): number {
    out.length = 0;
    let [sc, sr] = this.map.worldToCell(sx, sz);
    let [gc, gr] = this.map.worldToCell(gx, gz);
    [sc, sr] = this.nearestWalkableCell(sc, sr);
    [gc, gr] = this.nearestWalkableCell(gc, gr);
    const start = this.index(sc, sr), goal = this.index(gc, gr);
    if (!this.isWalkable(sc, sr) || !this.isWalkable(gc, gr)) return 0;
    this.stamp++;
    if (this.stamp > 0xfffffffe) { this.openStamp.fill(0); this.closedStamp.fill(0); this.stamp = 1; }
    this.heapSize = 0;
    this.gScore[start] = 0;
    this.fScore[start] = this.heuristic(start, goal);
    this.openStamp[start] = this.stamp;
    this.cameFrom[start] = -1;
    this.heapPush(start);
    let expanded = 0;
    let found = false;
    while (this.heapSize > 0 && expanded < maxNodes) {
      const cur = this.heapPop();
      if (this.closedStamp[cur] === this.stamp) continue;
      this.closedStamp[cur] = this.stamp;
      if (cur === goal) { found = true; break; }
      expanded++;
      const cc = cur % this.width, cr = (cur / this.width) | 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue;
          const nc = cc + dc, nr = cr + dr;
          if (!this.isWalkable(nc, nr)) continue;
          if (dc !== 0 && dr !== 0) {
            if (!this.isWalkable(cc + dc, cr) || !this.isWalkable(cc, cr + dr)) continue;
          }
          const ni = this.index(nc, nr);
          if (this.closedStamp[ni] === this.stamp) continue;
          const step = (dc !== 0 && dr !== 0 ? 1.41421356 : 1) * this.map.cellSize;
          const g = this.gScore[cur]! + step;
          if (this.openStamp[ni] !== this.stamp || g < this.gScore[ni]!) {
            this.openStamp[ni] = this.stamp;
            this.gScore[ni] = g;
            this.fScore[ni] = g + this.heuristic(ni, goal);
            this.cameFrom[ni] = cur;
            this.heapPush(ni);
          }
        }
      }
    }
    if (!found) return 0;
    const reversed: number[] = [];
    let cur = goal;
    let guard = 0;
    while (cur !== -1 && guard++ < 5000) { reversed.push(cur); cur = this.cameFrom[cur]!; }
    reversed.reverse();
    // Đơn giản hoá path bằng line-of-sight lưới.
    let anchorC = sc, anchorR = sr;
    for (let i = 1; i < reversed.length; i++) {
      const ni = reversed[i]!;
      const nc = ni % this.width, nr = (ni / this.width) | 0;
      const last = i === reversed.length - 1;
      if (last || !this.gridLineClear(anchorC, anchorR, nc, nr)) {
        const wx = this.map.originX + (nc + 0.5) * this.map.cellSize;
        const wz = this.map.originZ + (nr + 0.5) * this.map.cellSize;
        if (out.length === 0 || Math.hypot(wx - (out[out.length - 1]!.x), wz - (out[out.length - 1]!.z)) > 0.05) {
          out.push({ x: wx, y: this.map.floorHeightAt(wx, wz), z: wz });
        }
        anchorC = nc; anchorR = nr;
      }
    }
    if (out.length === 0) out.push({ x: gx, y: this.map.floorHeightAt(gx, gz), z: gz });
    return out.length;
  }

  private gridLineClear(c0: number, r0: number, c1: number, r1: number): boolean {
    const dx = c1 - c0, dz = r1 - r0;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    if (steps === 0) return true;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const c = Math.round(c0 + dx * t), r = Math.round(r0 + dz * t);
      if (!this.isWalkable(c, r)) return false;
    }
    return true;
  }

  randomWalkableNear(x: number, z: number, radiusCells: number, rng: () => number): [number, number] {
    const [c0, r0] = this.map.worldToCell(x, z);
    for (let attempt = 0; attempt < 40; attempt++) {
      const c = c0 + Math.round((rng() * 2 - 1) * radiusCells);
      const r = r0 + Math.round((rng() * 2 - 1) * radiusCells);
      if (this.isWalkable(c, r)) return this.map.cellCenter(c, r);
    }
    return this.map.cellCenter(...this.nearestWalkableCell(c0, r0));
  }

  /** Có thể đi bộ theo đường thẳng trên lưới (dùng cho kiểm tra cover/peek). */
  canWalkStraight(ax: number, az: number, bx: number, bz: number): boolean {
    let [ac, ar] = this.map.worldToCell(ax, az);
    const [bc, br] = this.map.worldToCell(bx, bz);
    [ac, ar] = this.nearestWalkableCell(ac, ar);
    return this.gridLineClear(ac, ar, bc, br);
  }
}
