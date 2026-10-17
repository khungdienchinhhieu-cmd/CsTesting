// Toán học dùng chung, tránh cấp phát trong vòng lặp nóng.
export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function smoothstep(t: number): number { const x = clamp01(t); return x * x * (3 - 2 * x); }
export function wrapAngle(a: number): number {
  // Chuẩn hoá về (-PI, PI]
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r <= -Math.PI) r += TAU;
  return r;
}
export function angleDelta(from: number, to: number): number { return wrapAngle(to - from); }
export function moveTowards(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}
export function vec3(x = 0, y = 0, z = 0): Vec3 { return { x, y, z }; }
export function setVec3(out: Vec3, x: number, y: number, z: number): Vec3 { out.x = x; out.y = y; out.z = z; return out; }
export function copyVec3(out: Vec3, a: Vec3): Vec3 { out.x = a.x; out.y = a.y; out.z = a.z; return out; }
export function addVec3(out: Vec3, a: Vec3, b: Vec3): Vec3 { out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z; return out; }
export function subVec3(out: Vec3, a: Vec3, b: Vec3): Vec3 { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; return out; }
export function scaleVec3(out: Vec3, a: Vec3, s: number): Vec3 { out.x = a.x * s; out.y = a.y * s; out.z = a.z * s; return out; }
export function dotVec3(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function lenVec3(a: Vec3): number { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
export function lenSqVec3(a: Vec3): number { return a.x * a.x + a.y * a.y + a.z * a.z; }
export function normVec3(out: Vec3, a: Vec3): Vec3 {
  const l = lenVec3(a);
  if (l < 1e-9) { out.x = 0; out.y = 0; out.z = 0; return out; }
  const inv = 1 / l; out.x = a.x * inv; out.y = a.y * inv; out.z = a.z * inv; return out;
}
export function distVec3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
export function distSqVec3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
/** Hướng nhìn từ yaw/pitch (yaw 0 = +Z, tăng theo chiều kim đồng hồ nhìn từ trên). */
export function lookDir(yaw: number, pitch: number, out: Vec3): Vec3 {
  const cp = Math.cos(pitch);
  out.x = Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = Math.cos(yaw) * cp;
  return out;
}
export function yawRight(yaw: number, out: Vec3): Vec3 {
  out.x = Math.cos(yaw); out.y = 0; out.z = -Math.sin(yaw); return out;
}
export function yawForward(yaw: number, out: Vec3): Vec3 {
  out.x = Math.sin(yaw); out.y = 0; out.z = Math.cos(yaw); return out;
}
export function aabbOverlap(
  aMinX: number, aMinY: number, aMinZ: number, aMaxX: number, aMaxY: number, aMaxZ: number,
  bMinX: number, bMinY: number, bMinZ: number, bMaxX: number, bMaxY: number, bMaxZ: number,
): boolean {
  return aMinX < bMaxX && aMaxX > bMinX && aMinY < bMaxY && aMaxY > bMinY && aMinZ < bMaxZ && aMaxZ > bMinZ;
}
export function pointInAABB(x: number, y: number, z: number, min: Vec3, max: Vec3): boolean {
  return x >= min.x && x <= max.x && y >= min.y && y <= max.y && z >= min.z && z <= max.z;
}
/** Giao tia với hộp AABB (slab). Trả về t hoặc -1. */
export function rayAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
): number {
  const invDx = 1 / dx, invDy = 1 / dy, invDz = 1 / dz;
  let t1 = (minX - ox) * invDx, t2 = (maxX - ox) * invDx;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (minY - oy) * invDy; t2 = (maxY - oy) * invDy;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (minZ - oz) * invDz; t2 = (maxZ - oz) * invDz;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < 0 || tmin > tmax) return -1;
  return tmin >= 0 ? tmin : 0;
}
/** Giao đoạn thẳng với AABB. */
export function segmentAABB(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const t = rayAABB(ax, ay, az, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ);
  return t >= 0 && t <= 1;
}
export function nextPow2(v: number): number { let p = 1; while (p < v) p *= 2; return p; }
