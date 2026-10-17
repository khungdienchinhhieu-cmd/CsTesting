import * as THREE from 'three/webgpu';
import { float, mix, positionLocal, sin, uniform } from 'three/tsl';

export interface LookdevScene {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

/**
 * Phòng look-dev M0: kiểm tra chất liệu TSL, ánh sáng, tone mapping trên cả WebGPU/WebGL2.
 * Toàn bộ hình học là placeholder thủ tục, có watermark ở lookdev.html.
 */
export function buildLookdevScene(): LookdevScene {
  const group = new THREE.Group();
  group.name = 'lookdev-room';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };

  const floorGeo = track(new THREE.PlaneGeometry(18, 18, 1, 1));
  const floorMat = new THREE.MeshStandardNodeMaterial({ color: 0x2b2a26, roughness: 0.82, metalness: 0.08 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMat = new THREE.MeshStandardNodeMaterial({ color: 0x4b463c, roughness: 0.9, metalness: 0.02 });
  const wallGeo = track(new THREE.BoxGeometry(18, 4.2, 0.4));
  const back = new THREE.Mesh(wallGeo, wallMat);
  back.position.set(0, 2.1, -9);
  back.receiveShadow = true;
  group.add(back);

  const plinthGeo = track(new THREE.BoxGeometry(2.2, 0.32, 2.2));
  const plinthMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1c1f, roughness: 0.55, metalness: 0.3 });
  const plinths = [-5, 0, 5];
  const colorA = uniform(new THREE.Color('#c9a05a'));
  const colorB = uniform(new THREE.Color('#16202e'));
  const seed = uniform(0.37);
  plinths.forEach((x, i) => {
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.set(x, 0.16, 0);
    plinth.receiveShadow = true;
    group.add(plinth);

    const geo = track(new THREE.IcosahedronGeometry(0.9, 4));
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.32, metalness: 0.72 });
    const wave = sin(positionLocal.x.mul(5).add(positionLocal.y.mul(3)).add(seed.mul(12))).mul(0.5).add(0.5);
    const palette = mix(colorA, colorB, float(i / 2));
    mat.colorNode = mix(palette.mul(0.45), palette, wave);
    mat.emissiveNode = palette.mul(wave.mul(0.22));
    const mesh = new THREE.Mesh(geo, track(mat));
    mesh.position.set(x, 1.45, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  const stripMat = new THREE.MeshBasicNodeMaterial({ color: 0xffb765 });
  const stripGeo = track(new THREE.BoxGeometry(14, 0.06, 0.06));
  const strip = new THREE.Mesh(stripGeo, track(stripMat));
  strip.position.set(0, 3.6, 8.6);
  group.add(strip);

  const hemi = new THREE.HemisphereLight(0xbdd0e0, 0x2a2018, 0.55);
  const key = new THREE.DirectionalLight(0xffd7a0, 2.4);
  key.position.set(-4, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const fill = new THREE.DirectionalLight(0x7396c8, 0.8);
  fill.position.set(6, 3, -4);
  group.add(hemi, key, fill);
  let elapsed = 0;

  return {
    group,
    update(dt: number): void {
      elapsed += dt;
      seed.value = (seed.value + dt * 0.05) % 1;
      group.rotation.y = Math.sin(elapsed * 0.1) * 0.02;
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
