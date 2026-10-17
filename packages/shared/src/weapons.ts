import type { GameData, WeaponDef } from './data';
import { clamp, DEG2RAD } from './math';
import { Rng } from './rng';
import type { AABB, HitboxGroup, PlayerState } from './types';

export interface ShotDirection { yaw: number; pitch: number }

export function currentSpreadDeg(p: PlayerState, w: WeaponDef, data: GameData): number {
  const s = w.spread;
  let base: number;
  const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  if (!p.grounded) base = speed > 1 ? s.jump : s.air;
  else if (p.crouching) base = s.crouch;
  else if (speed < 0.35) base = s.stand;
  else if (p.walking || speed < 2.9) base = s.walk;
  else base = s.run;
  if (p.scoped && w.scopeFov > 0) {
    if (!p.grounded) base = s.jump * 1.2;
    else if (p.crouching) base = s.scopedCrouch ?? s.scopedStand ?? base;
    else if (speed < 0.35) base = s.scopedStand ?? base;
    else if (speed < 2.9) base = s.scopedWalk ?? base;
  }
  const ramp = s.perShot * p.recoilShots;
  void data;
  return Math.max(0, base + ramp);
}

/**
 * Hướng bắn do server quyết định: pattern recoil có sẵn + tán đạn ngẫu nhiên.
 * Client dùng cùng pattern cho hiệu ứng camera nhưng không biết tán đạn.
 */
export function computeShotDirection(
  p: PlayerState, w: WeaponDef, rng: Rng, data: GameData, out: ShotDirection,
): ShotDirection {
  const pattern = w.recoil.pattern;
  const idx = Math.min(Math.max(0, p.recoilShots - 1), pattern.length - 1);
  const entry = pattern[idx]!;
  const spread = currentSpreadDeg(p, w, data);
  const spreadRad = spread * DEG2RAD;
  const r = Math.sqrt(rng.nextFloat()) * spreadRad;
  const theta = rng.nextFloat() * Math.PI * 2;
  const recoilX = entry[0] * DEG2RAD + Math.cos(theta) * r;
  const recoilY = entry[1] * DEG2RAD + Math.sin(theta) * r;
  out.yaw = p.yaw + recoilX + (rng.nextFloat() * 2 - 1) * w.recoil.horizontalVariance * DEG2RAD;
  out.pitch = clamp(p.pitch + recoilY, -1.55, 1.55);
  return out;
}

export function rangeAdjustedDamage(base: number, distance: number, rangeModifier: number): number {
  if (distance <= 0) return base;
  return base * Math.pow(rangeModifier, distance / 10);
}

export interface DamageResult {
  healthDamage: number;
  armorDamage: number;
  lethal: boolean;
  actualDamage: number;
}

/** Áp dụng giáp + hệ số hitbox. Không tin số từ client. */
export function computeDamage(
  victim: PlayerState, rawDamage: number, group: HitboxGroup, w: WeaponDef, data: GameData,
): DamageResult {
  let dmg = rawDamage * data.hitboxMultipliers[group];
  const head = group === 'head';
  // Giáp không bảo vệ chân; mũ chỉ bảo vệ đầu.
  const hasArmor = victim.armor > 0 && group !== 'legs' && (!head || victim.helmet);
  let healthDamage = dmg;
  let armorDamage = 0;
  if (hasArmor) {
    healthDamage = dmg * w.armorPenetration;
    armorDamage = dmg * data.armor.armorDamageFactor;
    if (head && victim.helmet) healthDamage *= data.gameplay.combat.armorHelmetHeadshotReduction;
    healthDamage = Math.max(0, healthDamage);
    armorDamage = Math.max(0, armorDamage);
  }
  dmg = Math.min(victim.health, healthDamage);
  return { healthDamage: dmg, armorDamage, lethal: victim.health - healthDamage <= 0, actualDamage: dmg };
}

/** Mô phỏng lực giật camera (client dự phòng). */
export function recoilOffsetFor(p: PlayerState, w: WeaponDef): [number, number] {
  const idx = Math.min(p.recoilShots, w.recoil.pattern.length - 1);
  return w.recoil.pattern[idx]!;
}

export function weaponsForTeam(data: GameData, team: 'T' | 'CT'): WeaponDef[] {
  return data.weaponsList.filter((w) => w.team === team || w.team === 'both');
}

/** Kiểm tra hướng tia có trúng AABB không, trả về khoảng cách gần nhất. */
export function rayVsAABB(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: AABB,
): number {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mins = [b.minX, b.minY, b.minZ], maxs = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-9) {
      if (o[i]! < mins[i]! || o[i]! > maxs[i]!) return -1;
    } else {
      let t1 = (mins[i]! - o[i]!) / d[i]!, t2 = (maxs[i]! - o[i]!) / d[i]!;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

export function isBackstab(attacker: PlayerState, victim: PlayerState): boolean {
  const ax = Math.sin(attacker.yaw), az = Math.cos(attacker.yaw);
  const vx = Math.sin(victim.yaw), vz = Math.cos(victim.yaw);
  return ax * vx + az * vz < -0.35;
}
