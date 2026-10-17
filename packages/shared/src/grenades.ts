import type { CollisionWorld } from './collision';
import type { SmokeDef } from './data';
import type { GrenadeProjectile, SmokeVolume } from './types';

const GRENADE_RADIUS = 0.09;

/** Cập nhật vật lý lựu đạn, trả về true nếu chạm đất/mặt phẳng (molotov). */
export function stepGrenade(
  g: GrenadeProjectile, dt: number, world: CollisionWorld, gravity = 15.2,
): boolean {
  g.vy -= gravity * dt;
  const speed = Math.sqrt(g.vx * g.vx + g.vy * g.vy + g.vz * g.vz);
  if (speed < 1e-5) return true;
  const dx = g.vx / speed, dy = g.vy / speed, dz = g.vz / speed;
  const travel = speed * dt;
  const hits: import('./collision').RayHit[] = [];
  world.raycastBullet(g.x, g.y, g.z, dx, dy, dz, travel + GRENADE_RADIUS, hits);
  const hit = hits.find((h) => h.t >= 0 && h.t <= travel + GRENADE_RADIUS) ?? null;
  let groundHit = false;
  if (hit) {
    const t = Math.max(0, hit.t - GRENADE_RADIUS);
    g.x += dx * t; g.y += dy * t; g.z += dz * t;
    const vn = g.vx * hit.nx + g.vy * hit.ny + g.vz * hit.nz;
    g.vx -= (1 + 0.45) * vn * hit.nx;
    g.vy -= (1 + 0.45) * vn * hit.ny;
    g.vz -= (1 + 0.45) * vn * hit.nz;
    // Ma sát tiếp tuyến
    g.vx *= 0.82; g.vz *= 0.82;
    if (Math.abs(g.vy) < 0.9) g.vy = 0;
    g.bounces++;
    if (hit.ny > 0.6) groundHit = true;
    // Tránh kẹt bên trong hình học
    g.x += hit.nx * 0.02; g.y += hit.ny * 0.02; g.z += hit.nz * 0.02;
  } else {
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y <= 0.08) { g.y = 0.08; groundHit = true; }
  }
  return groundHit;
}

export function throwVelocity(
  yaw: number, pitch: number, speed: number, forwardBias = 0,
): [number, number, number] {
  const cp = Math.cos(pitch);
  const dx = Math.sin(yaw) * cp;
  const dy = Math.sin(pitch);
  const dz = Math.cos(yaw) * cp;
  return [dx * speed + Math.sin(yaw) * forwardBias, dy * speed + 0.35, dz * speed + Math.cos(yaw) * forwardBias];
}

export interface SmokeGrid {
  grid: Uint8Array;
  size: number;
  cell: number;
  worldSize: number;
  cx: number; cy: number; cz: number;
}

export function createSmokeVolume(
  id: number, x: number, y: number, z: number, radius: number, startTick: number, endTick: number,
  smokeDef: SmokeDef,
): SmokeVolume {
  const size = smokeDef.voxelGrid;
  const grid = new Uint8Array(size * size * size);
  const cell = smokeDef.voxelWorldSize / size;
  const gridState: SmokeGrid = { grid, size, cell, worldSize: smokeDef.voxelWorldSize, cx: x, cy: y, cz: z };
  fillSphere(gridState, x, y, z, radius * 0.94, 220);
  return {
    id, x, y, z, radius, startTick, endTick, active: true, voxels: grid,
    holes: [],
  };
}

export function fillSphere(s: SmokeGrid, x: number, y: number, z: number, radius: number, value: number): void {
  const { grid, size, cell, cx, cy, cz } = s;
  const minI = Math.max(0, Math.floor((x - radius - (cx - s.worldSize / 2)) / cell));
  const maxI = Math.min(size - 1, Math.ceil((x + radius - (cx - s.worldSize / 2)) / cell));
  const minJ = Math.max(0, Math.floor((y - radius - (cy - s.worldSize / 2)) / cell));
  const maxJ = Math.min(size - 1, Math.ceil((y + radius - (cy - s.worldSize / 2)) / cell));
  const minK = Math.max(0, Math.floor((z - radius - (cz - s.worldSize / 2)) / cell));
  const maxK = Math.min(size - 1, Math.ceil((z + radius - (cz - s.worldSize / 2)) / cell));
  const r2 = radius * radius;
  for (let k = minK; k <= maxK; k++) {
    const wz = cz - s.worldSize / 2 + (k + 0.5) * cell - z;
    for (let j = minJ; j <= maxJ; j++) {
      const wy = cy - s.worldSize / 2 + (j + 0.5) * cell - y;
      for (let i = minI; i <= maxI; i++) {
        const wx = cx - s.worldSize / 2 + (i + 0.5) * cell - x;
        if (wx * wx + wy * wy + wz * wz <= r2) {
          grid[(k * size + j) * size + i] = value;
        }
      }
    }
  }
}

/** Khoét lỗ khói (đạn/HE). Chỉnh cả grid và danh sách lỗ để client hiển thị. */
export function carveSmokeHole(smoke: SmokeVolume, x: number, y: number, z: number, radius: number, smokeDef: SmokeDef): void {
  if (!smoke.voxels) return;
  const size = smokeDef.voxelGrid;
  const cell = smokeDef.voxelWorldSize / size;
  const gridState: SmokeGrid = {
    grid: smoke.voxels, size, cell, worldSize: smokeDef.voxelWorldSize,
    cx: smoke.x, cy: smoke.y, cz: smoke.z,
  };
  fillSphere(gridState, x, y, z, radius, 0);
  smoke.holes.push({ x, y, z, r: radius });
  if (smoke.holes.length > 24) smoke.holes.shift();
}

export function smokeDensityAt(smoke: SmokeVolume, x: number, y: number, z: number, smokeDef: SmokeDef): number {
  if (!smoke.voxels || !smoke.active) return 0;
  const size = smokeDef.voxelGrid;
  const half = smokeDef.voxelWorldSize / 2;
  const cell = smokeDef.voxelWorldSize / size;
  const i = Math.floor((x - (smoke.x - half)) / cell);
  const j = Math.floor((y - (smoke.y - half)) / cell);
  const k = Math.floor((z - (smoke.z - half)) / cell);
  if (i < 0 || j < 0 || k < 0 || i >= size || j >= size || k >= size) return 0;
  return smoke.voxels[(k * size + j) * size + i]! / 255;
}

/** Kiểm tra đoạn nhìn xuyên khói. Lấy mẫu dày để khớp xấp xỉ voxel. */
export function smokeBlocksSegment(
  smoke: SmokeVolume, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  smokeDef: SmokeDef,
): boolean {
  if (!smoke.voxels || !smoke.active) return false;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-4) return false;
  // Bỏ qua nhanh nếu đoạn không gần tâm khói
  const t0x = smoke.x - ax, t0y = smoke.y - ay, t0z = smoke.z - az;
  const proj = (t0x * dx + t0y * dy + t0z * dz) / (len * len);
  const clamped = Math.max(0, Math.min(1, proj));
  const px = ax + dx * clamped, py = ay + dy * clamped, pz = az + dz * clamped;
  const ddx = px - smoke.x, ddy = py - smoke.y, ddz = pz - smoke.z;
  if (ddx * ddx + ddy * ddy + ddz * ddz > smoke.radius * smoke.radius * 1.2) return false;
  const steps = Math.max(4, Math.ceil(len / (smokeDef.voxelWorldSize / smokeDef.voxelGrid) * 0.75));
  let dense = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (smokeDensityAt(smoke, ax + dx * t, ay + dy * t, az + dz * t, smokeDef) > 0.35) dense++;
  }
  // Cần đủ mẫu dày mới coi là che khuất (khói mỏng vẫn nhìn xuyên được)
  return dense / (steps + 1) > 0.52;
}

export function smokeSphereOverlap(
  smoke: SmokeVolume, x: number, y: number, z: number, radius: number,
): boolean {
  const dx = x - smoke.x, dy = y - smoke.y, dz = z - smoke.z;
  const rr = smoke.radius + radius;
  return dx * dx + dy * dy + dz * dz <= rr * rr;
}
