import * as THREE from 'three/webgpu';
import type { GameData } from '@tactical/shared';
import { createWeaponMesh } from './weaponMesh';

export interface RenderPlayer {
  id: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  health: number; armor: number;
  alive: boolean;
  crouching: boolean; walking: boolean;
  team: 'T' | 'CT';
  bot: boolean;
  weaponId: string;
  scoped: boolean;
  name: string;
}

function labelTexture(name: string, team: 'T' | 'CT', bot: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = 'bold 40px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = team === 'T' ? '#e8c06a' : '#8fc0ea';
    ctx.fillText(name.slice(0, 14).toUpperCase(), 256, 54);
    if (bot) {
      ctx.fillStyle = 'rgba(10,12,14,0.85)';
      ctx.fillRect(380, 14, 108, 44);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(380, 14, 108, 44);
      ctx.fillStyle = '#f2f2f2'; ctx.font = 'bold 30px ui-monospace, monospace';
      ctx.fillText('BOT', 434, 38);
    }
    ctx.fillStyle = team === 'T' ? 'rgba(232,192,106,0.55)' : 'rgba(143,192,234,0.55)';
    ctx.fillRect(226, 82, 60, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

const shadowTex = shadowTexture();

interface Materials {
  fabric: THREE.MeshStandardMaterial;
  vest: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  helmet: THREE.MeshStandardMaterial;
  boot: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
}

const materialCache = new Map<string, Materials>();
function teamMaterials(team: 'T' | 'CT'): Materials {
  const hit = materialCache.get(team);
  if (hit) return hit;
  const m: Materials = team === 'T'
    ? {
      fabric: new THREE.MeshStandardMaterial({ color: 0x8a7444, roughness: 0.92, metalness: 0.0 }),
      vest: new THREE.MeshStandardMaterial({ color: 0x5f5533, roughness: 0.8, metalness: 0.05 }),
      skin: new THREE.MeshStandardMaterial({ color: 0x9c7156, roughness: 0.85 }),
      helmet: new THREE.MeshStandardMaterial({ color: 0x6e6136, roughness: 0.6, metalness: 0.25 }),
      boot: new THREE.MeshStandardMaterial({ color: 0x2e2a22, roughness: 0.9 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x35301f, roughness: 0.85 }),
    }
    : {
      fabric: new THREE.MeshStandardMaterial({ color: 0x4d5a66, roughness: 0.92, metalness: 0.0 }),
      vest: new THREE.MeshStandardMaterial({ color: 0x323c46, roughness: 0.75, metalness: 0.1 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xa07a60, roughness: 0.85 }),
      helmet: new THREE.MeshStandardMaterial({ color: 0x3d4a55, roughness: 0.55, metalness: 0.35 }),
      boot: new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.9 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.85 }),
    };
  materialCache.set(team, m);
  return m;
}

export class CharacterView {
  readonly group = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly weaponHolder = new THREE.Group();
  private weaponId = '';
  private weaponGroup: THREE.Group | null = null;
  private readonly label: THREE.Sprite;
  private readonly shadow: THREE.Mesh;
  private readonly materials: Materials;
  private deadBlend = 0;
  private walkPhase = 0;
  private lastX: number;
  private lastZ: number;
  private speed = 0;
  private disposeFns: (() => void)[] = [];

  constructor(readonly id: number, team: 'T' | 'CT', readonly name: string, readonly bot: boolean, private data: GameData) {
    this.materials = teamMaterials(team);
    this.group.name = `player_${id}`;
    this.lastX = 0; this.lastZ = 0;

    const hipsGeo = new THREE.CylinderGeometry(0.19, 0.17, 0.16, 8);
    const hipsMesh = new THREE.Mesh(hipsGeo, this.materials.vest);
    hipsMesh.position.y = 0.92;
    this.hips.add(hipsMesh);
    this.group.add(this.hips);

    this.torso.position.y = 1.0;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.25), this.materials.fabric);
    chest.position.y = 0.25;
    chest.castShadow = true;
    this.torso.add(chest);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.34, 0.29), this.materials.vest);
    vest.position.y = 0.3;
    vest.castShadow = true;
    this.torso.add(vest);
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), this.materials.vest);
    pouch.position.set(0.12, 0.19, 0.17);
    this.torso.add(pouch);
    const pouch2 = pouch.clone();
    pouch2.position.set(-0.12, 0.19, 0.17);
    this.torso.add(pouch2);
    this.group.add(this.torso);

    this.head.position.y = 1.62;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.08, 8), this.materials.skin);
    neck.position.y = -0.07;
    this.head.add(neck);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), this.materials.skin);
    skull.scale.set(1, 1.06, 0.96);
    skull.castShadow = true;
    this.head.add(skull);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), this.materials.helmet);
    helmet.position.y = 0.02;
    helmet.castShadow = true;
    this.head.add(helmet);
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.03), new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.25, metalness: 0.5 }));
    goggles.position.set(0, 0.01, 0.105);
    this.head.add(goggles);
    this.group.add(this.head);

    for (const side of [-1, 1] as const) {
      const leg = side === -1 ? this.leftLeg : this.rightLeg;
      leg.position.set(side * 0.11, 0.9, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.44, 0.16), this.materials.fabric);
      thigh.position.y = -0.22;
      thigh.castShadow = true;
      leg.add(thigh);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.14), this.materials.fabric);
      shin.position.y = -0.64;
      shin.castShadow = true;
      leg.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.24), this.materials.boot);
      boot.position.set(0, -0.84, 0.04);
      leg.add(boot);
      this.group.add(leg);
    }
    for (const side of [-1, 1] as const) {
      const arm = side === -1 ? this.leftArm : this.rightArm;
      arm.position.set(side * 0.25, 1.43, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.3, 0.12), this.materials.fabric);
      upper.position.y = -0.15;
      upper.castShadow = true;
      arm.add(upper);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.1), this.materials.fabric);
      fore.position.set(0, -0.42, 0.14);
      fore.rotation.x = -0.9;
      arm.add(fore);
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1), this.materials.glove);
      glove.position.set(0, -0.52, 0.3);
      arm.add(glove);
      this.group.add(arm);
    }

    this.weaponHolder.position.set(0.12, 1.34, 0.22);
    this.group.add(this.weaponHolder);
    this.weaponHolder.add(this.rightArm);
    this.rightArm.position.set(0, 0, 0);
    this.rightArm.rotation.set(0, 0, 0);

    const tex = labelTexture(name, team, bot);
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, opacity: 0.95 }));
    this.label.position.set(0, 2.05, 0);
    this.label.scale.set(1.35, 0.34, 1);
    this.group.add(this.label);
    this.disposeFns.push(() => tex.dispose(), () => (this.label.material as THREE.SpriteMaterial).dispose());

    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.7 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.015;
    this.group.add(this.shadow);

    this.setWeapon(data.weapon(data.startingWeapons(team).secondary).id);
  }

  setWeapon(weaponId: string): void {
    if (this.weaponId === weaponId) return;
    this.weaponId = weaponId;
    if (this.weaponGroup) {
      this.weaponHolder.remove(this.weaponGroup);
      this.weaponGroup = null;
    }
    const mesh = createWeaponMesh(weaponId, this.data, 'world');
    const clone = mesh.group.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.y = Math.PI;
    this.weaponGroup = clone;
    this.weaponHolder.add(clone);
  }

  update(p: RenderPlayer, dt: number, isSelf: boolean): void {
    const dx = p.x - this.lastX, dz = p.z - this.lastZ;
    this.lastX = p.x; this.lastZ = p.z;
    const instSpeed = Math.min(8, Math.hypot(dx, dz) / Math.max(1e-4, dt));
    this.speed = this.speed * 0.75 + instSpeed * 0.25;

    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.y = p.yaw;
    this.group.visible = true;
    this.setWeapon(p.weaponId);

    const crouchScale = p.crouching ? 0.78 : 1;
    const targetBlend = p.alive ? 0 : 1;
    this.deadBlend += (targetBlend - this.deadBlend) * Math.min(1, dt * 7);
    this.group.rotation.z = this.deadBlend * 1.45;
    this.group.position.y = p.y + this.deadBlend * 0.15;
    this.group.scale.set(1, crouchScale * (1 - this.deadBlend * 0.15), 1);

    const walkAmp = Math.min(1, this.speed / 3.4);
    this.walkPhase += dt * (4 + this.speed * 1.35);
    const swing = Math.sin(this.walkPhase) * 0.55 * walkAmp;
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.leftArm.rotation.x = -swing * 0.4 - 0.5;
    this.rightArm.rotation.x = 0;
    this.weaponHolder.position.y = 1.34 + Math.abs(Math.sin(this.walkPhase)) * 0.02 * walkAmp;
    this.weaponHolder.rotation.x = -p.pitch * 0.85;
    this.torso.rotation.x = -p.pitch * 0.18;
    this.head.rotation.x = p.pitch * 0.5;
    this.torso.rotation.y = Math.sin(this.walkPhase * 0.5) * 0.05 * walkAmp;
    this.label.visible = !isSelf && p.alive;
    this.label.position.y = (p.crouching ? 1.75 : 2.05) + 0.05;
    this.label.material.opacity = 0.9;
    this.shadow.visible = p.alive;
    this.shadow.scale.setScalar(p.crouching ? 0.85 : 1);
    // ẩn mô hình của chính mình (chỉ viewmodel)
    if (isSelf) this.group.visible = false;
    if (!p.alive) this.label.visible = false;
  }

  dispose(): void {
    for (const fn of this.disposeFns) fn();
    if (this.weaponGroup) this.weaponGroup.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.group.removeFromParent();
  }
}

export class CharacterManager {
  private readonly views = new Map<number, CharacterView>();
  constructor(private readonly scene: THREE.Scene, private readonly data: GameData) {}

  sync(players: RenderPlayer[], dt: number, selfId: number): void {
    const seen = new Set<number>();
    for (const p of players) {
      seen.add(p.id);
      let v = this.views.get(p.id);
      if (!v) {
        v = new CharacterView(p.id, p.team, p.name, p.bot, this.data);
        this.views.set(p.id, v);
        this.scene.add(v.group);
      }
      v.update(p, dt, p.id === selfId);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { v.dispose(); this.views.delete(id); }
    }
  }

  healthBarColor(): number { return 0xffffff; }

  dispose(): void {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
  }
}
