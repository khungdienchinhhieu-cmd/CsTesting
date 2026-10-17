import * as THREE from 'three/webgpu';
import type { GameData, WeaponDef } from '@tactical/shared';
import { createWeaponMesh } from './weaponMesh';
import { createSkinMaterial, type SkinDef, type SkinInstance } from './skins';
import type { RendererHost } from './renderer';

const RELOAD_POS = new THREE.Vector3(0.3, -0.42, -0.44);
const BASE_POS = new THREE.Vector3(0.24, -0.235, -0.46);

function makeHands(): { group: THREE.Group; mats: THREE.Material[] } {
  const group = new THREE.Group();
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3c4034, roughness: 0.92 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x252a26, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9a7054, roughness: 0.8 });
  const mats = [sleeve, glove, skin];
  for (const side of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.3, 3, 8), sleeve);
    arm.position.set(side * 0.16, -0.31, -0.3);
    arm.rotation.set(-1.05, side * 0.24, side * 0.18);
    group.add(arm);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.09), side === 1 ? glove : skin);
    hand.position.set(side === 1 ? 0.075 : -0.055, -0.08, 0.19);
    hand.rotation.x = -0.25;
    group.add(hand);
  }
  return { group, mats };
}

export class ViewModel {
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly hands: THREE.Group;
  private readonly handMats: THREE.Material[];
  private weaponGroup: THREE.Group | null = null;
  private weapon: WeaponDef | null = null;
  private skinMat: THREE.MeshStandardNodeMaterial | null = null;
  private recoil = 0;
  private recoilRot = 0;
  private bobTime = 0;
  private swayX = 0;
  private swayY = 0;
  private reloadT = 0;
  private reloadDur = 1;
  private drawT = 0;
  private drawDur = 0.4;
  private scoped = false;
  private lastYaw = 0;
  private lastPitch = 0;
  private kickYaw = 0;
  private kickPitch = 0;

  constructor(host: RendererHost, private readonly data: GameData) {
    host.viewCamera.add(this.root);
    host.viewScene.add(host.viewCamera);
    this.root.add(this.pivot);
    this.pivot.position.copy(BASE_POS);
    this.pivot.rotation.set(0.02, Math.PI, 0.02);
    const h = makeHands();
    this.hands = h.group;
    this.handMats = h.mats;
    this.pivot.add(this.hands);
    this.root.visible = false;
  }

  setWeapon(weaponId: string, skin?: { def: SkinDef; inst: SkinInstance } | null): void {
    const w = this.data.weapon(weaponId);
    this.weapon = w;
    if (this.weaponGroup) { this.pivot.remove(this.weaponGroup); }
    this.skinMat?.dispose();
    this.skinMat = null;
    const src = createWeaponMesh(weaponId, this.data, 'view');
    const g = src.group.clone(true);
    g.rotation.y = 0;
    g.position.set(0, 0, 0);
    g.scale.setScalar(w.category === 'pistol' ? 0.9 : 0.92);
    if (skin) {
      this.skinMat = createSkinMaterial(skin.def, skin.inst, w);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshStandardMaterial;
          const isAccent = m.color && m.color.getHex() === 0xc9a24a;
          if (!isAccent) o.material = this.skinMat!;
          o.castShadow = false;
        }
      });
    }
    this.weaponGroup = g;
    this.pivot.add(g);
    this.pivot.visible = true;
    this.root.visible = true;
    this.drawT = w.drawTime;
    this.drawDur = Math.max(0.15, w.drawTime);
    this.scoped = false;
  }

  pulseFire(): void {
    this.recoil = Math.min(1, this.recoil + 0.55);
    this.recoilRot = Math.min(1, this.recoilRot + 0.6);
    const kick = 0.0026 + Math.random() * 0.0009;
    this.kickPitch += kick * 2.4;
    this.kickYaw += (Math.random() - 0.5) * kick;
  }

  startReload(durationSec: number): void {
    this.reloadT = durationSec;
    this.reloadDur = durationSec;
  }

  setScoped(scoped: boolean): void {
    this.scoped = scoped;
  }

  update(dt: number, state: { speed: number; grounded: boolean; yaw: number; pitch: number; crouching: boolean; reloading: boolean; alive: boolean }): void {
    if (!this.weapon) { this.root.visible = false; return; }
    this.root.visible = state.alive && !this.scoped;
    this.bobTime += dt * (2.2 + state.speed * 1.9);
    const speedAmp = Math.min(1, state.speed / 4.4);
    const bobX = Math.sin(this.bobTime) * 0.016 * speedAmp;
    const bobY = Math.abs(Math.cos(this.bobTime)) * 0.012 * speedAmp;
    // sway khi xoay chuột
    let dyaw = state.yaw - this.lastYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dpitch = state.pitch - this.lastPitch;
    this.lastYaw = state.yaw; this.lastPitch = state.pitch;
    this.swayX += (-dyaw * 0.22 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (dpitch * 0.2 - this.swayY) * Math.min(1, dt * 9);
    this.swayX = THREE.MathUtils.clamp(this.swayX, -0.09, 0.09);
    this.swayY = THREE.MathUtils.clamp(this.swayY, -0.07, 0.07);
    this.kickPitch *= Math.exp(-dt * 12);
    this.kickYaw *= Math.exp(-dt * 12);

    this.recoil *= Math.exp(-dt * 13);
    this.recoilRot *= Math.exp(-dt * 11);
    if (this.reloadT > 0) this.reloadT = Math.max(0, this.reloadT - dt);
    if (this.drawT > 0) this.drawT = Math.max(0, this.drawT - dt);
    const reloadFrac = this.reloadDur > 0 ? this.reloadT / this.reloadDur : 0;
    const reloadDip = Math.sin(Math.min(1, reloadFrac) * Math.PI);
    const drawFrac = this.drawDur > 0 ? this.drawT / this.drawDur : 0;

    const target = BASE_POS.clone();
    target.x += bobX + this.swayX;
    target.y += bobY + this.swayY - reloadDip * 0.18 - drawFrac * 0.3;
    target.z += this.recoil * 0.085 + drawFrac * 0.12;
    if (state.crouching) target.y -= 0.012;
    this.pivot.position.lerp(target, Math.min(1, dt * 16));
    this.pivot.rotation.x = 0.02 + this.recoilRot * 0.16 - reloadDip * 0.5 + drawFrac * 0.4 + this.kickPitch + this.swayY * 0.5;
    this.pivot.rotation.y = Math.PI + this.kickYaw + this.swayX * 0.9 + Math.sin(this.bobTime * 0.5) * 0.004;
    this.pivot.rotation.z = 0.02 + reloadDip * 0.28 + this.swayX * 0.7;
    this.hands.position.copy(this.pivot.position).multiplyScalar(0);
    void RELOAD_POS; void this.handMats; void this.reloadT; void state.grounded; void state.reloading;
  }

  dispose(): void {
    this.pivot.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    this.skinMat?.dispose();
    this.root.removeFromParent();
  }
}
