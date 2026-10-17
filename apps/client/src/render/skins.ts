import * as THREE from 'three/webgpu';
import { color, float, fract, positionLocal, sin, smoothstep, uniform, vec3, mix } from 'three/tsl';
import type { WeaponDef } from '@tactical/shared';

export interface SkinDef {
  id: string;
  name: string;
  rarity: string;
  collection: string;
  weapons: string[];
  status: string;
  palette: string[];
  patternScale: number;
  patternSeedMode: string;
  flakeDensity: number;
  emissive: string;
  wearEdgeColor: string;
  roughnessBase: number;
  metalnessBase: number;
  textureBudget: number;
}

export interface SkinInstance {
  skinId: string;
  patternSeed: number;
  wear: number;
  tally?: number;
}

/**
 * Uber-shader cho skin: họa tiết + wear + seed bằng TSL,
 * chạy trên cả WebGPU và WebGL2 (three.js biên dịch node material cho cả hai backend).
 */
export function createSkinMaterial(def: SkinDef, inst: SkinInstance, w: WeaponDef, anisotropy = 4): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const palette = def.palette.length >= 4 ? def.palette : [...def.palette, ...def.palette, ...def.palette];
  const c0 = color(palette[0] ?? '#888888');
  const c1 = color(palette[1] ?? '#555555');
  const c2 = color(palette[2] ?? '#bbbbbb');
  const c3 = color(palette[3] ?? '#222222');
  const seed = uniform((inst.patternSeed % 997) / 997 * 10);
  const wear = uniform(Math.min(1, Math.max(0, inst.wear)));
  const scale = uniform(def.patternScale * 9 + w.price / 4000);
  const p = positionLocal.mul(scale);
  const n = sin(p.x.mul(1.7).add(seed)).mul(sin(p.y.mul(2.3).add(seed.mul(0.7))))
    .mul(sin(p.z.mul(1.3).add(seed.mul(1.7))));
  const grain = sin(p.x.mul(11).add(n.mul(2))).mul(sin(p.z.mul(9).add(seed))).mul(0.5).add(0.5);
  const band = fract(p.y.mul(0.55).add(p.z.mul(0.18)).add(n.mul(0.35)).add(seed.mul(0.1)));
  const stripe = smoothstep(0.42, 0.58, band);
  let col = mix(c0, c1, stripe.mul(0.85));
  col = mix(col, c2, smoothstep(0.72, 0.9, grain).mul(0.28 + def.flakeDensity * 1.4));
  const wearMask = smoothstep(0.55, 1.0, wear.add(grain.mul(0.28))).mul(0.55);
  col = mix(col, c3, wearMask);
  mat.colorNode = vec3(col.x, col.y, col.z);
  mat.roughnessNode = float(def.roughnessBase).add(grain.mul(0.15)).sub(wearMask.mul(0.1));
  mat.metalnessNode = float(def.metalnessBase).add(wearMask.mul(0.2));
  if (def.emissive && def.emissive !== '#000000') {
    mat.emissiveNode = color(def.emissive).mul(0.35).add(grain.mul(0.12));
  }
  void anisotropy;
  void c3;
  return mat;
}
