import * as THREE from 'three/webgpu';
import type { GameData, WeaponDef } from '@tactical/shared';

export interface WeaponMesh {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  bodyMaterials: THREE.MeshStandardMaterial[];
  ejectPort: THREE.Object3D;
  dispose: () => void;
}

const cache = new Map<string, WeaponMesh>();

function mat(color: number, roughness = 0.62, metalness = 0.35): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(w: number, h: number, d: number, material: THREE.MeshStandardMaterial, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function cyl(r: number, len: number, material: THREE.MeshStandardMaterial, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z'): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r, r, len, 10);
  const m = new THREE.Mesh(geo, material);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** Súng procedural low-poly, thiết kế gốc; không dùng model ngoài. */
export function createWeaponMesh(weaponId: string, data: GameData, mode: 'view' | 'world' = 'view'): WeaponMesh {
  const key = `${weaponId}:${mode}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w: WeaponDef = data.weapon(weaponId);
  const group = new THREE.Group();
  const bodyMaterials: THREE.MeshStandardMaterial[] = [];
  const metal = mat(0x2b2f33, 0.44, 0.78); bodyMaterials.push(metal);
  const polymer = mat(0x3b4038, 0.8, 0.08); bodyMaterials.push(polymer);
  const furniture = mat(w.category === 'rifle' && w.team === 'T' ? 0x7a5128 : 0x4a4f46, 0.78, 0.05); bodyMaterials.push(furniture);
  const accent = mat(0xc9a24a, 0.5, 0.6);
  const muzzle = new THREE.Object3D();
  const ejectPort = new THREE.Object3D();

  const scale = mode === 'view' ? 1 : 0.95;
  if (w.category === 'rifle' || w.category === 'sniper' || w.category === 'shotgun') {
    const isSniper = w.category === 'sniper';
    const isShotgun = w.category === 'shotgun';
    const len = isSniper ? 0.98 : isShotgun ? 0.82 : 0.72;
    group.add(box(0.075, 0.11, len * 0.62, metal, 0, 0, len * 0.12));
    group.add(box(0.065, 0.075, len * 0.44, metal, 0, 0.015, len * 0.56));
    // ốp thân
    group.add(box(0.082, 0.085, 0.34, furniture, 0, -0.018, len * 0.12));
    // băng đạn
    if (!isSniper) {
      const mag = box(0.06, isShotgun ? 0.07 : 0.2, 0.115, polymer, 0, isShotgun ? -0.07 : -0.125, 0.05);
      mag.rotation.x = isShotgun ? 0 : -0.22;
      group.add(mag);
    }
    // báng
    group.add(box(0.055, 0.1, 0.28, furniture, 0, -0.01, -len * 0.36));
    group.add(box(0.06, 0.16, 0.07, polymer, 0, -0.1, -len * 0.43));
    // tay cầm
    const grip = box(0.05, 0.16, 0.075, polymer, 0, -0.1, -0.02);
    grip.rotation.x = -0.26;
    group.add(grip);
    if (isSniper) {
      const scopeBody = cyl(0.05, 0.32, metal, 0, 0.12, 0.06, 'z');
      group.add(scopeBody);
      group.add(box(0.03, 0.06, 0.06, polymer, 0, 0.07, -0.04));
      group.add(box(0.03, 0.06, 0.06, polymer, 0, 0.07, 0.16));
    } else {
      group.add(box(0.012, 0.028, 0.05, metal, 0, 0.075, len * 0.18));
      group.add(box(0.012, 0.028, 0.05, metal, 0, 0.075, -len * 0.12));
      group.add(box(0.055, 0.012, 0.22, polymer, 0, 0.055, 0.0));
    }
    if (isShotgun) {
      group.add(cyl(0.035, 0.36, polymer, 0, -0.05, 0.36, 'z'));
    }
    // đầu nòng
    group.add(cyl(isSniper ? 0.018 : 0.022, 0.16, metal, 0, 0.015, len * 0.8, 'z'));
    muzzle.position.set(0, 0.015, len * 0.88);
    group.add(muzzle);
    ejectPort.position.set(0.06, 0.03, 0.1);
    group.add(ejectPort);
    group.add(box(0.02, 0.03, 0.02, accent, 0.045, 0.04, 0.22));
  } else if (w.category === 'smg') {
    group.add(box(0.065, 0.1, 0.38, metal, 0, 0, 0.08));
    group.add(cyl(0.018, 0.18, metal, 0, 0.01, 0.34, 'z'));
    group.add(box(0.055, 0.2, 0.06, polymer, 0, -0.13, -0.02));
    group.add(box(0.05, 0.12, 0.05, polymer, 0, -0.09, -0.14));
    group.add(box(0.03, 0.04, 0.2, polymer, 0, 0.055, -0.02));
    group.add(box(0.05, 0.05, 0.16, furniture, 0, -0.02, -0.22));
    muzzle.position.set(0, 0.01, 0.45);
    group.add(muzzle);
    ejectPort.position.set(0.04, 0.03, 0.1);
    group.add(ejectPort);
  } else if (w.category === 'pistol') {
    group.add(box(0.05, 0.075, 0.26, metal, 0, 0.035, 0.05));
    group.add(box(0.045, 0.085, 0.16, polymer, 0, -0.03, 0.02));
    const grip = box(0.045, 0.13, 0.06, polymer, 0, -0.075, -0.07);
    grip.rotation.x = -0.28;
    group.add(grip);
    group.add(cyl(0.013, 0.06, metal, 0, 0.045, 0.2, 'z'));
    group.add(box(0.012, 0.012, 0.012, accent, 0, 0.085, 0.14));
    muzzle.position.set(0, 0.045, 0.24);
    group.add(muzzle);
    ejectPort.position.set(0.032, 0.06, 0.04);
    group.add(ejectPort);
  } else {
    // dao
    const blade = box(0.012, 0.05, 0.3, metal, 0, 0.03, 0.16);
    group.add(blade);
    group.add(box(0.025, 0.09, 0.03, polymer, 0, 0, 0.03));
    group.add(box(0.035, 0.04, 0.12, furniture, 0, -0.01, -0.06));
    muzzle.position.set(0, 0.03, 0.32);
    ejectPort.position.set(0, 0, 0);
  }
  group.scale.setScalar(scale);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.castShadow = mode === 'world'; o.receiveShadow = false; }
  });
  const result: WeaponMesh = {
    group, muzzle, bodyMaterials, ejectPort,
    dispose: () => {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      });
    },
  };
  cache.set(key, result);
  return result;
}

export function clearWeaponMeshCache(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
