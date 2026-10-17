import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Collider, GameMap } from '@tactical/shared';
import type { AssetLoader } from '../assets/loader';

const MATERIAL_MAP: Record<string, { tex: string; bump: string; color: number; roughness: number; metalness: number; uvScale: number }> = {
  sandstone: { tex: 'sandstone', bump: 'sandstone_bump', color: 0xffffff, roughness: 0.92, metalness: 0.0, uvScale: 0.32 },
  concrete: { tex: 'concrete', bump: 'concrete_bump', color: 0xf0efe8, roughness: 0.95, metalness: 0.0, uvScale: 0.3 },
  metal: { tex: 'metal', bump: 'metal_bump', color: 0xb9c2c9, roughness: 0.48, metalness: 0.72, uvScale: 0.4 },
  wood: { tex: 'wood', bump: 'wood_bump', color: 0xffffff, roughness: 0.82, metalness: 0.0, uvScale: 0.5 },
  sand: { tex: 'sand', bump: 'sand_bump', color: 0xffffff, roughness: 1.0, metalness: 0.0, uvScale: 0.18 },
};

function scaleBoxUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, scale: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f]!;
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su * scale, uv.getY(idx) * sv * scale);
    }
  }
  uv.needsUpdate = true;
}

function makeSky(env: { skyColor: string; horizonColor: string; fogColor: string }): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, env.skyColor);
    g.addColorStop(0.55, env.horizonColor);
    g.addColorStop(0.78, env.fogColor);
    g.addColorStop(1, '#b9a273');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(280, 24, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -100;
  return sky;
}

function makeGroundTexture(assets: AssetLoader, theme: string): THREE.Texture {
  const t = assets.get(theme === 'desert' ? 'sand' : 'concrete').clone();
  t.needsUpdate = true;
  t.repeat.set(60, 60);
  t.anisotropy = 8;
  return t;
}

export interface MapVisual {
  group: THREE.Group;
  sky: THREE.Mesh;
  spawnFloors: THREE.Mesh[];
  siteMeshes: THREE.Mesh[];
  dust: THREE.Points;
  dispose: () => void;
}

export function buildMapVisual(map: GameMap, assets: AssetLoader): MapVisual {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const env = map.json.environment;

  const sky = makeSky(env);
  group.add(sky);
  disposables.push(sky.geometry, sky.material as THREE.Material, (sky.material as THREE.MeshBasicMaterial).map as THREE.Texture);

  const groundTex = makeGroundTexture(assets, env.theme);
  disposables.push(groundTex);
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, color: 0xd8c6a2, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.03, 0);
  ground.receiveShadow = true;
  group.add(ground);

  // Gom collider theo vật liệu rồi merge để giảm draw call
  const buckets = new Map<string, THREE.BufferGeometry[]>();
  const trimGeos: THREE.BufferGeometry[] = [];
  for (const col of map.colliders) {
    const w = col.maxX - col.minX, h = col.maxY - col.minY, d = col.maxZ - col.minZ;
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) continue;
    if (col.id === 'floor') continue;
    const def = MATERIAL_MAP[col.material] ?? MATERIAL_MAP.concrete!;
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(geo, w, h, d, def.uvScale);
    geo.translate(col.minX + w / 2, col.minY + h / 2, col.minZ + d / 2);
    // vertex color: tối dần ở chân tường để tạo cảm giác AO
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const ao = THREE.MathUtils.clamp(0.58 + (y - col.minY) / Math.max(0.8, h) * 0.42, 0.5, 1);
      const tint = col.material === 'sandstone' ? [ao, ao * 0.98, ao * 0.94] : [ao, ao, ao];
      colors[i * 3] = tint[0]!; colors[i * 3 + 1] = tint[1]!; colors[i * 3 + 2] = tint[2]!;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const key = col.material;
    const list = buckets.get(key) ?? [];
    list.push(geo);
    buckets.set(key, list);
    if (h > 2.2) {
      const bottom = new THREE.BoxGeometry(w + 0.03, 0.9, d + 0.03);
      scaleBoxUV(bottom, w, 0.9, d, def.uvScale * 1.2);
      bottom.translate(col.minX + w / 2, col.minY + 0.45, col.minZ + d / 2);
      trimGeos.push(bottom);
    }
  }
  for (const [material, geos] of buckets) {
    const def = MATERIAL_MAP[material] ?? MATERIAL_MAP.concrete!;
    const mapTex = assets.get(def.tex);
    const bump = assets.get(def.bump);
    const mat = new THREE.MeshStandardMaterial({
      map: mapTex, bumpMap: bump, bumpScale: 0.04, vertexColors: true,
      color: def.color, roughness: def.roughness, metalness: def.metalness,
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(merged, mat);
    for (const g of geos) g.dispose();
  }
  if (trimGeos.length) {
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x3f3a32, roughness: 0.95, metalness: 0.05 });
    const merged = mergeGeometries(trimGeos, false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, trimMat);
      mesh.receiveShadow = true;
      group.add(mesh);
      disposables.push(merged, trimMat);
    }
    for (const g of trimGeos) g.dispose();
  }

  // Vạch kẻ sân / vùng đặt bom
  const siteMeshes: THREE.Mesh[] = [];
  for (const site of map.json.sites) {
    const tex = assets.get(`site_${site.id.toLowerCase()}`);
    const [x1, z1, x2, z2] = site.rect;
    const size = Math.min(6, Math.min(x2 - x1, z2 - z1) * 0.75);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(site.center[0], 0.025, site.center[2]);
    group.add(mesh);
    siteMeshes.push(mesh);
    disposables.push(mesh.geometry, mat);
    // vòng tròn site
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe0b442, transparent: true, opacity: 0.35, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(size * 0.62, size * 0.68, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center[0], 0.02, site.center[2]);
    group.add(ring);
    disposables.push(ring.geometry, ringMat);
  }

  const spawnFloors: THREE.Mesh[] = [];
  for (const team of ['T', 'CT'] as const) {
    const color = team === 'T' ? 0xd6a23a : 0x6fa8d6;
    for (const [x, y, z] of map.json.spawns[team]) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y + 0.02, z);
      group.add(mesh);
      spawnFloors.push(mesh);
      disposables.push(mesh.geometry, mat);
    }
  }

  // Props trang trí
  for (const p of map.json.props) {
    group.add(buildProp(p.kind, p.x, p.y, p.z, p.rot, p.scale, disposables));
  }

  // Đụn cát / vật thể nền xa để phá đường chân trời
  if (env.theme === 'desert') {
    const duneMat = new THREE.MeshStandardMaterial({ color: 0xb09060, roughness: 1, metalness: 0, flatShading: true });
    disposables.push(duneMat);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.3;
      const r = 90 + (i % 4) * 26;
      const size = 22 + (i % 5) * 9;
      const geo = new THREE.ConeGeometry(size, 10 + (i % 3) * 7, 6, 1);
      const m = new THREE.Mesh(geo, duneMat);
      m.position.set(Math.cos(a) * r, -2, Math.sin(a) * r);
      m.scale.set(1.6, 1, 0.9);
      m.rotation.y = a * 2;
      group.add(m);
      disposables.push(geo);
    }
  }

  // Bụi lơ lửng
  const dustCount = 700;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 110;
    dustPos[i * 3 + 1] = Math.random() * 9;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 110;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xf0dfb8, size: 0.045, transparent: true, opacity: 0.4, depthWrite: false, sizeAttenuation: true });
  const dust = new THREE.Points(dustGeo, dustMat);
  group.add(dust);
  disposables.push(dustGeo, dustMat);

  const dispose = (): void => {
    for (const d of disposables) d.dispose();
    group.clear();
  };
  return { group, sky, spawnFloors, siteMeshes, dust, dispose };
}

function buildProp(kind: string, x: number, y: number, z: number, rot: number, scale: number, disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rot;
  g.scale.setScalar(scale);
  if (kind.startsWith('barrel')) {
    const geo = new THREE.CylinderGeometry(0.36, 0.36, 1.1, 14);
    const mat = new THREE.MeshStandardMaterial({ color: kind.includes('red') ? 0x8a3a2a : 0x5b6b5a, roughness: 0.62, metalness: 0.5 });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.55; m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    for (const yy of [0.18, 0.92]) {
      const ringGeo = new THREE.TorusGeometry(0.365, 0.03, 6, 16);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x2e353b, roughness: 0.5, metalness: 0.7 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2; ring.position.y = yy;
      g.add(ring);
      disposables.push(ringGeo, ringMat);
    }
    disposables.push(geo, mat);
  } else {
    const wood = kind.includes('wood');
    const geo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
    const mat = new THREE.MeshStandardMaterial({
      color: wood ? 0x9a7444 : 0x6b747b, roughness: wood ? 0.85 : 0.55, metalness: wood ? 0 : 0.45,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.55; m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    // khung cạnh
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x2b2a26, transparent: true, opacity: 0.5 }));
    edge.position.y = 0.55;
    g.add(edge);
    disposables.push(geo, mat, edge.geometry, edge.material as THREE.Material);
  }
  return g;
}

export function colliderMaterialAt(map: GameMap, x: number, y: number, z: number): string {
  const hits: Collider[] = [];
  for (const c of map.colliders) {
    if (x >= c.minX && x <= c.maxX && y >= c.minY && y <= c.maxY && z >= c.minZ && z <= c.maxZ) hits.push(c);
  }
  return hits.length ? hits[hits.length - 1]!.material : 'concrete';
}
