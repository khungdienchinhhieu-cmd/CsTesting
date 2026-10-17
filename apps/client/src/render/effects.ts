import * as THREE from 'three/webgpu';
import type { GameEvent } from '@tactical/shared';
import type { AssetLoader } from '../assets/loader';

interface Tracer {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  life: number;
  max: number;
}

interface Pulse {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  max: number;
  grow: number;
  velocity: THREE.Vector3;
}

interface SmokeGroup {
  group: THREE.Group;
  sprites: { sprite: THREE.Sprite; base: THREE.Vector3; phase: number }[];
  mats: THREE.SpriteMaterial[];
  radius: number;
  age: number;
  endTick: number;
}

export interface EffectCallbacks {
  onHitMarker?: (headshot: boolean, kill: boolean) => void;
  onFireLight?: (x: number, y: number, z: number) => void;
}

export class EffectsManager {
  private tracers: Tracer[] = [];
  private pulses: Pulse[] = [];
  private decals: THREE.Mesh[] = [];
  private decalMat: THREE.MeshBasicMaterial;
  private smokeMap = new Map<number, SmokeGroup>();
  private fireMap = new Map<number, { group: THREE.Group; light: THREE.PointLight; mats: THREE.SpriteMaterial[]; radius: number; endTick: number }>();
  private bombGroup: THREE.Group | null = null;
  private bombLight: THREE.PointLight | null = null;
  private smokeLayers: number;
  private readonly smokeTex: THREE.Texture;
  private readonly flashTex: THREE.Texture;
  private readonly holeTex: THREE.Texture;

  constructor(private readonly scene: THREE.Scene, assets: AssetLoader, layers: number) {
    this.smokeLayers = layers;
    this.smokeTex = assets.get('smoke');
    this.flashTex = assets.get('flash');
    this.holeTex = assets.get('hole');
    this.decalMat = new THREE.MeshBasicMaterial({ map: this.holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  }

  setSmokeLayers(layers: number): void { this.smokeLayers = layers; }

  private tracer(x: number, y: number, z: number, dx: number, dy: number, dz: number, color = 0xffd9a0): void {
    const len = 38;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(x + dx * len, y + dy * len, z + dz * len),
    ]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, mat, life: 0.055, max: 0.055 });
  }

  private pulse(x: number, y: number, z: number, opts: { tex: THREE.Texture; color: number; size: number; life: number; grow: number; vel?: THREE.Vector3; opacity?: number; additive?: boolean }): void {
    const mat = new THREE.SpriteMaterial({
      map: opts.tex, color: opts.color, transparent: true, opacity: opts.opacity ?? 0.9,
      depthWrite: false, blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(opts.size);
    this.scene.add(sprite);
    this.pulses.push({
      sprite, mat, life: opts.life, max: opts.life, grow: opts.grow,
      velocity: opts.vel ? opts.vel.clone() : new THREE.Vector3(),
    });
  }

  private decal(x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), this.decalMat);
    mesh.position.set(x, y, z);
    mesh.lookAt(x, y + 0.01, z + 1);
    this.scene.add(mesh);
    this.decals.push(mesh);
    if (this.decals.length > 64) {
      const old = this.decals.shift()!;
      old.geometry.dispose();
      this.scene.remove(old);
    }
  }

  muzzle(x: number, y: number, z: number): void {
    this.pulse(x, y, z, { tex: this.flashTex, color: 0xffe0a0, size: 0.55, life: 0.055, grow: 1.6 });
  }

  explosion(x: number, y: number, z: number, big = false): void {
    const size = big ? 6 : 3.2;
    this.pulse(x, y, z, { tex: this.flashTex, color: 0xffb060, size, life: big ? 0.5 : 0.32, grow: 5, opacity: 0.9 });
    this.pulse(x, y + 0.2, z, { tex: this.smokeTex, color: 0x6a6156, size: size * 0.8, life: 1.2, grow: 2.2, opacity: 0.7, additive: false });
    for (let i = 0; i < (big ? 26 : 14); i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9;
      this.pulse(x, y, z, {
        tex: this.flashTex, color: 0xffaa55, size: 0.08 + Math.random() * 0.1,
        life: 0.25 + Math.random() * 0.4, grow: 0.4, opacity: 0.95,
        vel: new THREE.Vector3(Math.cos(a) * (3 + Math.random() * 6), up * 7, Math.sin(a) * (3 + Math.random() * 6)),
      });
    }
  }

  flashbang(x: number, y: number, z: number): void {
    this.pulse(x, y, z, { tex: this.flashTex, color: 0xffffff, size: 2.2, life: 0.35, grow: 4, opacity: 1 });
  }

  handleEvent(e: GameEvent, selfId: number): void {
    switch (e.type) {
      case 'shot':
        if (e.playerId === selfId) return;
        this.tracer(e.x, e.y, e.z, e.dx, e.dy, e.dz);
        this.muzzle(e.x, e.y, e.z);
        break;
      case 'impact':
        this.decal(e.x, e.y, e.z);
        for (let i = 0; i < 3; i++) {
          this.pulse(e.x, e.y, e.z, {
            tex: this.flashTex, color: 0xffcc88, size: 0.045,
            life: 0.16 + Math.random() * 0.12, grow: 0.2, opacity: 0.8,
            vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3),
          });
        }
        break;
      case 'hit':
        if (e.attacker === selfId) {
          this.pulse(e.x, e.y, e.z, { tex: this.flashTex, color: e.lethal ? 0xffdddd : 0xff8866, size: 0.24, life: 0.15, grow: 0.5, opacity: 0.9 });
        }
        break;
      case 'grenade_explode':
        this.explosion(e.x, e.y + 0.2, e.z, e.kind === 'he');
        break;
      case 'bomb_exploded':
        this.explosion(e.x, e.y + 0.5, e.z, true);
        break;
      case 'flash':
        this.flashbang(e.x, e.y, e.z);
        break;
      case 'smoke_start':
        break;
      case 'smoke_end':
        break;
      case 'kill':
        break;
      case 'bomb_beep':
        break;
      default:
        break;
    }
  }

  syncSmokes(smokes: { id: number; x: number; y: number; z: number; radius: number; endTick: number }[], tick: number): void {
    const seen = new Set<number>();
    for (const s of smokes) {
      seen.add(s.id);
      if (this.smokeMap.has(s.id)) {
        const g = this.smokeMap.get(s.id)!;
        g.endTick = s.endTick;
        continue;
      }
      const group = new THREE.Group();
      group.position.set(s.x, s.y + s.radius * 0.35, s.z);
      const sprites: SmokeGroup['sprites'] = [];
      const mats: THREE.SpriteMaterial[] = [];
      const count = this.smokeLayers;
      for (let i = 0; i < count; i++) {
        // phân bố trong khối cầu, mật độ dày ở tâm
        const u = Math.random(), v = Math.random(), w = Math.random();
        const theta = Math.acos(2 * u - 1), phi = v * Math.PI * 2;
        const r = Math.cbrt(w) * s.radius * 0.72;
        const base = new THREE.Vector3(
          Math.sin(theta) * Math.cos(phi) * r,
          Math.cos(theta) * r * 0.8,
          Math.sin(theta) * Math.sin(phi) * r,
        );
        const mat = new THREE.SpriteMaterial({
          map: this.smokeTex, color: 0xd8d5cc, transparent: true,
          opacity: 0.5 / Math.pow(count, 0.55), depthWrite: false, blending: THREE.NormalBlending,
          rotation: Math.random() * Math.PI * 2,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(base);
        const sc = s.radius * (0.85 + Math.random() * 0.5);
        sprite.scale.setScalar(sc);
        group.add(sprite);
        sprites.push({ sprite, base, phase: Math.random() * Math.PI * 2 });
        mats.push(mat);
      }
      this.scene.add(group);
      this.smokeMap.set(s.id, { group, sprites, mats, radius: s.radius, age: 0, endTick: s.endTick });
    }
    for (const [id, g] of this.smokeMap) {
      if (!seen.has(id) || tick > g.endTick) {
        this.scene.remove(g.group);
        for (const m of g.mats) m.dispose();
        this.smokeMap.delete(id);
      }
    }
  }

  syncFires(fires: { id: number; x: number; z: number; radius: number; endTick: number }[], tick: number): void {
    const seen = new Set<number>();
    for (const f of fires) {
      seen.add(f.id);
      if (this.fireMap.has(f.id)) continue;
      const group = new THREE.Group();
      group.position.set(f.x, 0, f.z);
      const mats: THREE.SpriteMaterial[] = [];
      for (let i = 0; i < 10; i++) {
        const mat = new THREE.SpriteMaterial({ map: this.smokeTex, color: i % 2 ? 0xff8a30 : 0xffc060, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending });
        const sp = new THREE.Sprite(mat);
        const a = Math.random() * Math.PI * 2, r = Math.random() * f.radius * 0.8;
        sp.position.set(Math.cos(a) * r, 0.3 + Math.random() * 0.7, Math.sin(a) * r);
        sp.scale.setScalar(0.7 + Math.random() * 1.1);
        group.add(sp);
        mats.push(mat);
      }
      const light = new THREE.PointLight(0xff7a2a, 3.2, f.radius * 2.4, 1.7);
      light.position.y = 0.7;
      group.add(light);
      this.scene.add(group);
      this.fireMap.set(f.id, { group, light, mats, radius: f.radius, endTick: f.endTick });
    }
    for (const [id, f] of this.fireMap) {
      if (!seen.has(id) || tick > f.endTick) {
        this.scene.remove(f.group);
        f.light.dispose();
        for (const m of f.mats) m.dispose();
        this.fireMap.delete(id);
      }
    }
  }

  setBomb(planted: boolean, x: number, y: number, z: number, timeLeft: number): void {
    if (!planted) {
      if (this.bombGroup) { this.scene.remove(this.bombGroup); this.bombGroup.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); this.bombGroup = null; }
      if (this.bombLight) { this.bombLight.dispose(); this.bombLight = null; }
      return;
    }
    if (!this.bombGroup) {
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5, metalness: 0.6 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.22), bodyMat);
      body.position.y = 0.08; g.add(body);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), ledMat);
      led.position.set(0.08, 0.17, 0.02); g.add(led);
      this.bombGroup = g;
      this.scene.add(g);
      this.bombLight = new THREE.PointLight(0xff2010, 1.8, 4, 2);
      this.bombLight.position.set(0, 0.3, 0);
      g.add(this.bombLight);
    }
    this.bombGroup.position.set(x, y, z);
    if (this.bombLight) {
      const phase = Math.sin(performance.now() * (0.004 + Math.max(0, 1 - timeLeft / 40) * 0.03));
      this.bombLight.intensity = phase > 0 ? 2.4 : 0.2;
    }
  }

  update(dt: number): void {
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => {
      if (t.life > 0) {
        t.mat.opacity = Math.max(0, t.life / t.max) * 0.7;
        return true;
      }
      this.scene.remove(t.line); t.line.geometry.dispose(); t.mat.dispose(); return false;
    });
    for (const p of this.pulses) {
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= 4.5 * dt;
      p.sprite.scale.setScalar(Math.max(0.001, p.sprite.scale.x + p.grow * dt));
      p.mat.opacity = Math.max(0, (1 - k) * 0.95);
    }
    this.pulses = this.pulses.filter((p) => {
      if (p.life > 0) return true;
      this.scene.remove(p.sprite); p.mat.dispose(); return false;
    });
    for (const [id, s] of this.smokeMap) {
      s.age += dt;
      for (const sp of s.sprites) {
        sp.phase += dt * 0.4;
        sp.sprite.position.set(
          sp.base.x + Math.sin(sp.phase) * 0.16 * s.radius / 4,
          sp.base.y + Math.cos(sp.phase * 0.8) * 0.1,
          sp.base.z + Math.cos(sp.phase * 1.1) * 0.16 * s.radius / 4,
        );
        sp.sprite.material.rotation += dt * 0.03;
      }
      void id;
    }
    for (const f of this.fireMap.values()) f.light.intensity = 2.2 + Math.sin(performance.now() * 0.012) * 0.9 + Math.random() * 0.4;
  }

  dispose(): void {
    for (const t of this.tracers) { this.scene.remove(t.line); t.line.geometry.dispose(); t.mat.dispose(); }
    for (const p of this.pulses) { this.scene.remove(p.sprite); p.mat.dispose(); }
    for (const d of this.decals) { this.scene.remove(d); d.geometry.dispose(); }
    for (const s of this.smokeMap.values()) { this.scene.remove(s.group); for (const m of s.mats) m.dispose(); }
    for (const f of this.fireMap.values()) { this.scene.remove(f.group); for (const m of f.mats) m.dispose(); }
    if (this.bombGroup) this.scene.remove(this.bombGroup);
    if (this.bombLight) this.bombLight.dispose();
    this.decalMat.dispose();
    this.tracers = []; this.pulses = []; this.decals = []; this.smokeMap.clear(); this.fireMap.clear();
  }
}
