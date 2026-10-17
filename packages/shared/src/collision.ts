// Thế giới va chạm tĩnh: AABB + BVH. Dùng chung client/server, không phụ thuộc three.js.
export interface Collider {
  id: string;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  material: string;
  solid: boolean;
  walkable: boolean;
  blocksSight: boolean;
  blocksBullets: boolean;
  /** 0 = không xuyên được, 1 = xuyên dễ (gỗ/tôn mỏng). */
  penetration: number;
  zone: string;
}

export interface RayHit {
  t: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  collider: Collider;
  /** true nếu tia đi vào trong hộp (dùng cho xuyên tường). */
  entering: boolean;
}

interface BVHNode {
  minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number;
  left: number; right: number; start: number; count: number;
}

const LEAF_SIZE = 6;

export function makeCollider(
  id: string, min: [number, number, number], max: [number, number, number],
  material: string, opts: Partial<Collider> = {},
): Collider {
  return {
    id,
    minX: min[0], minY: min[1], minZ: min[2],
    maxX: max[0], maxY: max[1], maxZ: max[2],
    material,
    solid: opts.solid ?? true,
    walkable: opts.walkable ?? false,
    blocksSight: opts.blocksSight ?? true,
    blocksBullets: opts.blocksBullets ?? true,
    penetration: opts.penetration ?? 0,
    zone: opts.zone ?? '',
  };
}

export class CollisionWorld {
  readonly colliders: Collider[];
  private nodes: BVHNode[] = [];
  private items: Collider[] = [];
  private stack: number[] = new Array(128).fill(0);

  constructor(colliders: Collider[]) {
    this.colliders = colliders;
    this.items = colliders.slice();
    this.build();
  }

  private build(): void {
    const n = this.items.length;
    const indices = new Array<number>(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    this.nodes.length = 0;
    const recurse = (start: number, count: number): number => {
      const nodeIndex = this.nodes.length;
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity, cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;
      for (let i = start; i < start + count; i++) {
        const c = this.items[indices[i]!]!;
        if (c.minX < minX) minX = c.minX; if (c.minY < minY) minY = c.minY; if (c.minZ < minZ) minZ = c.minZ;
        if (c.maxX > maxX) maxX = c.maxX; if (c.maxY > maxY) maxY = c.maxY; if (c.maxZ > maxZ) maxZ = c.maxZ;
        const cx = (c.minX + c.maxX) * 0.5, cy = (c.minY + c.maxY) * 0.5, cz = (c.minZ + c.maxZ) * 0.5;
        if (cx < cMinX) cMinX = cx; if (cy < cMinY) cMinY = cy; if (cz < cMinZ) cMinZ = cz;
        if (cx > cMaxX) cMaxX = cx; if (cy > cMaxY) cMaxY = cy; if (cz > cMaxZ) cMaxZ = cz;
      }
      const node: BVHNode = { minX, minY, minZ, maxX, maxY, maxZ, left: -1, right: -1, start, count };
      this.nodes.push(node);
      if (count <= LEAF_SIZE) return nodeIndex;
      const ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ;
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const slice = indices.slice(start, start + count);
      slice.sort((a, b) => {
        const ca = this.items[a]!, cb = this.items[b]!;
        const va = axis === 0 ? ca.minX + ca.maxX : axis === 1 ? ca.minY + ca.maxY : ca.minZ + ca.maxZ;
        const vb = axis === 0 ? cb.minX + cb.maxX : axis === 1 ? cb.minY + cb.maxY : cb.minZ + cb.maxZ;
        return va - vb;
      });
      for (let i = 0; i < count; i++) indices[start + i] = slice[i]!;
      const mid = count >> 1;
      const left = recurse(start, mid);
      const right = recurse(start + mid, count - mid);
      this.nodes[nodeIndex]!.left = left;
      this.nodes[nodeIndex]!.right = right;
      return nodeIndex;
    };
    if (n > 0) recurse(0, n);
  }

  private rayNode(
    nodeIndex: number, ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxDist: number,
    needSight: boolean, needBullets: boolean, out: RayHit[],
  ): void {
    let sp = 0;
    this.stack[sp++] = nodeIndex;
    while (sp > 0) {
      const ni = this.stack[--sp]!;
      const node = this.nodes[ni];
      if (!node) continue;
      const bt = rayBox(ox, oy, oz, dx, dy, dz, node.minX, node.minY, node.minZ, node.maxX, node.maxY, node.maxZ, maxDist);
      if (bt < 0) continue;
      if (node.left < 0) {
        for (let i = node.start; i < node.start + node.count; i++) {
          const c = this.items[i]!;
          if (needSight && !c.blocksSight) continue;
          if (needBullets && !c.blocksBullets) continue;
          if (!c.solid && !c.blocksSight) continue;
          const hit = rayCollider(ox, oy, oz, dx, dy, dz, c, maxDist);
          if (hit) out.push(hit);
        }
      } else {
        if (sp + 2 < this.stack.length) {
          this.stack[sp++] = node.left;
          this.stack[sp++] = node.right;
        }
      }
    }
  }

  /** Tia nhìn (bỏ qua vật không chặn tầm nhìn). Trả về hit gần nhất. */
  raycastSight(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): RayHit | null {
    this.scratch.length = 0;
    this.rayNode(0, ox, oy, oz, dx, dy, dz, maxDist, true, false, this.scratch);
    let best: RayHit | null = null;
    for (const h of this.scratch) if (!best || h.t < best.t) best = h;
    return best;
  }

  private scratch: RayHit[] = [];

  /** Mọi va chạm của viên đạn, sắp xếp tăng dần. */
  raycastBullet(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: RayHit[]): void {
    out.length = 0;
    this.rayNode(0, ox, oy, oz, dx, dy, dz, maxDist, false, true, out);
    out.sort((a, b) => a.t - b.t);
  }

  segmentClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    const hit = this.raycastSight(ax, ay, az, dx / len, dy / len, dz / len, len);
    return hit === null;
  }

  /** Trả về true nếu AABB giao bất kỳ collider solid nào. */
  overlaps(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const query: RayHit[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const c = this.items[i]!;
      if (!c.solid && !c.walkable) continue;
      if (minX < c.maxX && maxX > c.minX && minY < c.maxY && maxY > c.minY && minZ < c.maxZ && maxZ > c.minZ) return true;
    }
    void query;
    return false;
  }

  /** Chỉ va chạm với vật đặc (bỏ sàn walkable) — dùng cho di chuyển ngang. */
  overlapsSolid(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    for (let i = 0; i < this.items.length; i++) {
      const c = this.items[i]!;
      if (!c.solid) continue;
      if (minX < c.maxX && maxX > c.minX && minY < c.maxY && maxY > c.minY && minZ < c.maxZ && maxZ > c.minZ) return true;
    }
    return false;
  }

  pointInsideSolid(x: number, y: number, z: number): boolean {
    for (let i = 0; i < this.items.length; i++) {
      const c = this.items[i]!;
      if (x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ) return true;
    }
    return false;
  }

  /** Độ cao mặt sàn tại (x,z), cao nhất không vượt quá fromY. */
  floorHeightAt(x: number, z: number, fromY = 20): number {
    let best = -Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const c = this.items[i]!;
      if (!c.walkable) continue;
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.maxY <= fromY + 1e-6 && c.maxY > best) best = c.maxY;
    }
    return best;
  }

  static fromBoxes(boxes: Collider[]): CollisionWorld { return new CollisionWorld(boxes); }
}

/** Giao tia với box, trả về t hoặc -1. */
function rayBox(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, maxDist: number,
): number {
  let tmin = 0, tmax = maxDist;
  // trục X
  if (Math.abs(dx) < 1e-9) { if (ox < minX || ox > maxX) return -1; }
  else {
    let t1 = (minX - ox) / dx, t2 = (maxX - ox) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < minY || oy > maxY) return -1; }
  else {
    let t1 = (minY - oy) / dy, t2 = (maxY - oy) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < minZ || oz > maxZ) return -1; }
  else {
    let t1 = (minZ - oz) / dz, t2 = (maxZ - oz) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

function rayCollider(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, c: Collider, maxDist: number,
): RayHit | null {
  let tmin = 0, tmax = maxDist;
  let nx = 0, ny = 0, nz = 0;
  const axes = 0;
  void axes;
  // X
  if (Math.abs(dx) < 1e-9) { if (ox < c.minX || ox > c.maxX) return null; }
  else {
    let t1 = (c.minX - ox) / dx, t2 = (c.maxX - ox) / dx;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = sign; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Y
  if (Math.abs(dy) < 1e-9) { if (oy < c.minY || oy > c.maxY) return null; }
  else {
    let t1 = (c.minY - oy) / dy, t2 = (c.maxY - oy) / dy;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = sign; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Z
  if (Math.abs(dz) < 1e-9) { if (oz < c.minZ || oz > c.maxZ) return null; }
  else {
    let t1 = (c.minZ - oz) / dz, t2 = (c.maxZ - oz) / dz;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || tmin > maxDist) return null;
  return {
    t: tmin,
    x: ox + dx * tmin, y: oy + dy * tmin, z: oz + dz * tmin,
    nx, ny, nz, collider: c, entering: true,
  };
}

export function boxIntersectsCollider(
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, c: Collider,
): boolean {
  return minX < c.maxX && maxX > c.minX && minY < c.maxY && maxY > c.minY && minZ < c.maxZ && maxZ > c.minZ;
}
