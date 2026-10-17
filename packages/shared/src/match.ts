import { MAX_PLAYERS, SNAPSHOT_RATE, TICK_RATE } from './constants';
import { CollisionWorld, type RayHit } from './collision';
import type { GameData, MovementDef, WeaponDef } from './data';
import { carveSmokeHole, createSmokeVolume, smokeBlocksSegment, stepGrenade, throwVelocity } from './grenades';
import { computeHitboxes, hitboxGroupAt, HitboxHistory, arrayToHitbox } from './hitbox';
import { GameMap } from './map';
import { clamp, DEG2RAD, distVec3, lookDir, wrapAngle, angleDelta } from './math';
import { NavGrid } from './navmesh';
import { Rng } from './rng';
import {
  Buttons, type AmmoState, type GameEvent, type GrenadeKind, type GrenadeProjectile,
  type HitboxGroup, type HitboxState, type InputCommand, type MatchConfig, type PlayerId,
  type PlayerLoadout, type PlayerState, type RoundState, type SmokeVolume, type FireVolume,
  type Team, type WeaponCategory,
} from './types';
import { computeDamage, computeShotDirection, isBackstab, rangeAdjustedDamage } from './weapons';
import { stepMovement } from './movement';

export interface SimOptions {
  config: MatchConfig;
  data: GameData;
  map: GameMap;
  seed?: number;
}

export interface AddPlayerOptions {
  id: PlayerId;
  name: string;
  team: Team;
  isBot: boolean;
  botReplacing?: boolean;
}

export interface DroppedWeapon {
  id: number; weaponId: string; x: number; y: number; z: number;
  ammo: number; reserve: number; dropTick: number;
}

export interface BuyResult { ok: boolean; reason?: string }

const GRENADE_KINDS: GrenadeKind[] = ['he', 'flash', 'smoke', 'molotov', 'incendiary'];
const OTHER: Record<Team, Team> = { T: 'CT', CT: 'T' };

function emptyHitbox(): HitboxState {
  const mk = () => ({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
  return { head: mk(), chest: mk(), stomach: mk(), legs: mk() };
}

export function emptyLoadout(team: Team, defensivePistol = false): PlayerLoadout {
  const pistol = defensivePistol ? 'pistol_ct' : team === 'T' ? 'pistol_t' : 'pistol_ct';
  return {
    primary: null,
    secondary: pistol,
    grenades: { he: 0, flash: 0, smoke: 0, molotov: 0, incendiary: 0 },
    armor: 0,
    helmet: false,
    defuseKit: false,
  };
}

export function createPlayerState(
  id: PlayerId, name: string, team: Team, isBot: boolean, data: GameData,
): PlayerState {
  const loadout = emptyLoadout(team);
  const secondary = loadout.secondary!;
  const w = data.weapon(secondary);
  const ammo: Record<string, AmmoState> = {
    [secondary]: { mag: w.magazine, reserve: w.reserve },
    knife: { mag: 0, reserve: 0 },
  };
  return {
    id, name, team, isBot, botReplacing: isBot && false, connected: true,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, eyeY: 1.64,
    crouching: false, walking: false, grounded: true,
    health: 100, armor: 0, helmet: false, alive: true,
    money: data.economy.startMoney, kills: 0, deaths: 0, assists: 0, damageDealt: 0, roundsPlayed: 0,
    loadout, activeSlot: 'secondary', activeWeapon: secondary, activeGrenade: null,
    ammo, reloadingUntilTick: 0, reloadingWeapon: null, nextAttackTick: 0, lastAttackTick: 0,
    triggerWasDown: false, jumpWasDown: false, prevButtons: 0,
    recoilShots: 0, lastShotTick: 0, scoped: false, hasBomb: false,
    plantProgress: 0, defuseProgress: 0, defuseKitActive: false,
    blindUntilTick: 0, flashIntensity: 0, burnUntilTick: 0, lastDamageTick: 0,
    spawnTick: 0, respawnAtTick: 0,
    dropRequested: false, inspectUntilTick: 0, drawingUntilTick: 0, planting: false, defusing: false,
    lastFootstepTick: 0, lastDamagedBy: null, assistCreditUntilTick: 0, spawnIndex: 0,
    ping: 0, mvmtState: 'idle',
  };
}

export class MatchSim {
  readonly config: MatchConfig;
  readonly data: GameData;
  readonly map: GameMap;
  readonly nav: NavGrid;
  readonly collision: CollisionWorld;
  readonly move: MovementDef;
  readonly history = new HitboxHistory();
  readonly players: PlayerState[] = [];
  readonly byId = new Map<PlayerId, PlayerState>();
  round: RoundState;
  tick = 0;
  events: GameEvent[] = [];
  private spareEvents: GameEvent[] = [];
  grenades: GrenadeProjectile[] = [];
  smokes: SmokeVolume[] = [];
  fires: FireVolume[] = [];
  dropped: DroppedWeapon[] = [];
  bombDropped = false;
  bombDropX = 0; bombDropY = 0; bombDropZ = 0;
  bombPlanterId: PlayerId | null = null;
  bombDefuserId: PlayerId | null = null;
  started = false;
  finished = false;
  seed: number;
  rng: Rng;
  private nextEntityId = 1;
  private nextDropId = 1;
  private nextBeepTick = 0;
  private inputs = new Map<PlayerId, InputCommand[]>();
  private lastInput = new Map<PlayerId, InputCommand>();
  private lastSeq = new Map<PlayerId, number>();
  private bulletHits: RayHit[] = [];
  private playerHitboxScratch: HitboxState = emptyHitbox();
  private neutralInput: InputCommand = {
    seq: 0, tick: 0, dt: TICK_RATE ? 1 / TICK_RATE : 0.015625, forward: 0, right: 0,
    yaw: 0, pitch: 0, buttons: 0, grenadeSlot: 0,
  };

  constructor(opts: SimOptions) {
    this.config = opts.config;
    this.data = opts.data;
    this.map = opts.map;
    this.nav = new NavGrid(opts.map);
    this.collision = opts.map.collision;
    this.move = opts.data.gameplay.movement;
    this.seed = opts.seed ?? 1;
    this.rng = new Rng(this.seed);
    this.round = {
      phase: 'warmup', phaseEndTick: 0, roundNumber: 0, scoreT: 0, scoreCT: 0,
      bombPlanted: false, bombSite: null, bombX: 0, bombY: 0, bombZ: 0,
      bombTimerEndTick: 0, bombBeingPlantedBy: null, bombBeingDefusedBy: null,
      bombDefuseEndTick: 0, winner: null, winReason: null, roundStartTick: 0,
      lossStreakT: 0, lossStreakCT: 0, halftimeDone: false, overtime: false, overtimeBlock: 0,
    };
  }

  addPlayer(opts: AddPlayerOptions): PlayerState {
    if (this.players.length >= MAX_PLAYERS) throw new Error('[sim] phòng đã đầy');
    if (this.byId.has(opts.id)) throw new Error(`[sim] trùng player id ${opts.id}`);
    const p = createPlayerState(opts.id, opts.name, opts.team, opts.isBot, this.data);
    p.botReplacing = opts.botReplacing ?? false;
    const teamCount = this.players.filter((q) => q.team === opts.team).length;
    p.spawnIndex = teamCount;
    this.players.push(p);
    this.byId.set(p.id, p);
    this.inputs.set(p.id, []);
    return p;
  }

  removePlayer(id: PlayerId): void {
    const p = this.byId.get(id);
    if (!p) return;
    p.connected = false;
    p.alive = false;
    this.inputs.delete(id);
  }

  getPlayer(id: PlayerId): PlayerState | undefined { return this.byId.get(id); }
  aliveCount(team: Team): number { return this.players.filter((p) => p.alive && p.team === team).length; }

  start(): void {
    if (this.started) return;
    this.started = true;
    const warmup = this.config.warmupSec ?? this.data.gameplay.round.warmupSec;
    if (this.config.mode === 'range') {
      this.round.phase = 'live';
      this.round.roundNumber = 1;
      this.round.phaseEndTick = Number.MAX_SAFE_INTEGER;
      this.spawnAll();
      for (const p of this.players) if (this.data.gameplay.range.infiniteMoney) p.money = 16000;
      this.round.roundStartTick = this.tick;
      return;
    }
    if (this.config.mode === 'deathmatch') {
      this.round.phase = 'live';
      this.round.roundNumber = 1;
      this.round.phaseEndTick = Number.MAX_SAFE_INTEGER;
      this.round.roundStartTick = this.tick;
      this.spawnAll();
      return;
    }
    if (warmup > 0) {
      this.round.phase = 'warmup';
      this.round.phaseEndTick = this.tick + Math.round(warmup * TICK_RATE);
      this.spawnAll();
    } else {
      this.beginRound(1);
    }
  }

  private spawnAll(): void {
    const spawnCounter: Record<Team, number> = { T: 0, CT: 0 };
    for (const p of this.players) {
      const idx = spawnCounter[p.team]++;
      p.spawnIndex = idx;
      this.spawnPlayer(p, idx);
    }
  }

  private spawnPlayer(p: PlayerState, index: number): void {
    const [x, y, z] = this.map.spawn(p.team, index);
    p.x = x; p.y = y; p.z = z;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.health = 100;
    p.armor = p.loadout.armor;
    p.alive = true;
    p.crouching = false;
    p.walking = false;
    p.grounded = true;
    p.eyeY = y + this.move.standEye;
    p.yaw = p.team === 'T' ? Math.PI / 2 : -Math.PI / 2;
    p.pitch = 0;
    p.plantProgress = 0;
    p.defuseProgress = 0;
    p.planting = false;
    p.defusing = false;
    p.reloadingUntilTick = 0;
    p.reloadingWeapon = null;
    p.scoped = false;
    p.triggerWasDown = false;
    p.jumpWasDown = false;
    p.prevButtons = 0;
    p.recoilShots = 0;
    p.nextAttackTick = 0;
    p.drawingUntilTick = this.tick + 4;
    p.blindUntilTick = 0;
    p.flashIntensity = 0;
    p.burnUntilTick = 0;
    p.spawnTick = this.tick;
    p.respawnAtTick = 0;
    p.mvmtState = 'idle';
    if (p.team === 'CT' && p.loadout.defuseKit) p.hasBomb = false;
    this.events.push({ type: 'spawn', tick: this.tick, playerId: p.id });
    this.selectBestWeapon(p, true);
  }

  private selectBestWeapon(p: PlayerState, silent = false): void {
    if (p.loadout.primary) {
      this.setActiveWeapon(p, p.loadout.primary, 'primary', silent);
    } else if (p.loadout.secondary) {
      this.setActiveWeapon(p, p.loadout.secondary, 'secondary', silent);
    } else {
      this.setActiveWeapon(p, 'knife', 'knife', silent);
    }
  }

  private setActiveWeapon(p: PlayerState, weaponId: string, slot: 'primary' | 'secondary' | 'knife', silent = false): void {
    p.activeWeapon = weaponId;
    p.activeSlot = slot;
    p.scoped = false;
    p.reloadingUntilTick = 0;
    p.reloadingWeapon = null;
    const w = this.data.weapon(weaponId);
    p.drawingUntilTick = this.tick + Math.round(w.drawTime * TICK_RATE);
    this.ensureAmmo(p, weaponId);
    if (!silent) this.events.push({ type: 'weapon_switch', tick: this.tick, playerId: p.id, weapon: weaponId });
  }

  private ensureAmmo(p: PlayerState, weaponId: string): AmmoState {
    let a = p.ammo[weaponId];
    if (!a) {
      const w = this.data.weapon(weaponId);
      a = { mag: w.magazine, reserve: w.reserve };
      p.ammo[weaponId] = a;
    }
    return a;
  }

  private activeWeaponDef(p: PlayerState): WeaponDef {
    return this.data.weapon(p.activeWeapon || p.loadout.secondary || 'knife');
  }

  submitInput(id: PlayerId, cmd: InputCommand): void {
    const p = this.byId.get(id);
    if (!p || !p.connected) return;
    const last = this.lastSeq.get(id) ?? -1;
    if (!Number.isFinite(cmd.seq) || cmd.seq <= last) return;
    if (cmd.seq - last > 1000) return;
    const sanitized: InputCommand = {
      seq: cmd.seq,
      tick: Number.isFinite(cmd.tick) ? cmd.tick : this.tick,
      dt: 1 / TICK_RATE,
      forward: clamp(Number.isFinite(cmd.forward) ? cmd.forward : 0, -1, 1),
      right: clamp(Number.isFinite(cmd.right) ? cmd.right : 0, -1, 1),
      yaw: Number.isFinite(cmd.yaw) ? wrapAngle(cmd.yaw) : p.yaw,
      pitch: clamp(Number.isFinite(cmd.pitch) ? cmd.pitch : 0, -1.55, 1.55),
      buttons: (cmd.buttons | 0) & 0xffff,
      grenadeSlot: clamp(cmd.grenadeSlot | 0, 0, 4),
      viewTick: Number.isFinite(cmd.viewTick) ? clamp(cmd.viewTick!, this.tick - TICK_RATE * 0.25, this.tick + 1) : this.tick,
    };
    this.lastSeq.set(id, cmd.seq);
    const q = this.inputs.get(id);
    if (!q) return;
    q.push(sanitized);
    if (q.length > 12) q.splice(0, q.length - 12);
  }

  private consumeInput(p: PlayerState): InputCommand {
    const q = this.inputs.get(p.id);
    if (q && q.length > 0) {
      const cmd = q.shift()!;
      const out = { ...cmd, viewTick: cmd.viewTick ?? this.tick };
      this.lastInput.set(p.id, out);
      return out;
    }
    const last = this.lastInput.get(p.id);
    this.neutralInput.yaw = p.yaw;
    this.neutralInput.pitch = p.pitch;
    this.neutralInput.seq = last ? last.seq : 0;
    this.neutralInput.tick = this.tick;
    this.neutralInput.viewTick = this.tick;
    return this.neutralInput;
  }

  step(): GameEvent[] {
    if (!this.started) this.start();
    this.tick++;
    // this.events có thể đã chứa sự kiện mua đồ phát sinh giữa các tick.
    this.history.record(this.tick, this.players);
    this.processPhase();

    for (const p of this.players) {
      if (!p.connected) continue;
      this.updateRespawn(p);
      if (!p.alive) continue;
      const cmd = this.consumeInput(p);
      this.updatePlayer(p, cmd);
    }

    this.updateGrenades();
    this.updateVolumes();
    this.updateBomb();
    this.checkRoundEnd();
    this.cleanupRoundState();
    // Đổi buffer: sự kiện vừa trả về không bị xoá ở tick kế tiếp.
    const out = this.events;
    this.events = this.spareEvents;
    this.events.length = 0;
    this.spareEvents = out;
    return out;
  }

  private processPhase(): void {
    const r = this.round;
    if (r.phase === 'warmup') {
      if (this.tick >= r.phaseEndTick) this.beginRound(1);
      return;
    }
    if (r.phase === 'freeze') {
      if (this.tick >= r.phaseEndTick) {
        r.phase = 'live';
        r.roundStartTick = this.tick;
        r.phaseEndTick = this.tick + Math.round((this.config.roundTimeSec || this.data.gameplay.round.roundTimeSec) * TICK_RATE);
        this.events.push({ type: 'round_freeze_end', tick: this.tick });
      }
      return;
    }
    if (r.phase === 'over') {
      if (this.tick >= r.phaseEndTick) {
        if (this.finished) {
          r.phase = 'matchEnd';
          return;
        }
        if ((r.roundNumber === 12 && !r.halftimeDone) || (r.overtime && (r.roundNumber - 24) % 6 === 3)) {
          this.swapSides();
        }
        this.beginRound(r.roundNumber + 1);
      }
      return;
    }
    if (r.phase === 'live') {
      if (!r.bombPlanted && this.tick >= r.phaseEndTick) {
        this.endRound('CT', 'time');
      }
    }
  }

  private beginRound(number: number): void {
    const r = this.round;
    r.roundNumber = number;
    r.phase = 'freeze';
    r.phaseEndTick = this.tick + Math.round((this.config.freezeTimeSec ?? this.data.gameplay.round.freezeTimeSec) * TICK_RATE);
    r.roundStartTick = r.phaseEndTick;
    r.bombPlanted = false;
    r.bombSite = null;
    r.bombBeingPlantedBy = null;
    r.bombBeingDefusedBy = null;
    r.bombDefuseEndTick = 0;
    r.winner = null;
    r.winReason = null;
    this.bombDropped = false;
    this.bombPlanterId = null;
    this.bombDefuserId = null;
    this.nextBeepTick = 0;
    this.grenades.length = 0;
    this.smokes.length = 0;
    this.fires.length = 0;
    this.dropped.length = 0;

    for (const p of this.players) {
      p.roundsPlayed++;
      p.plantProgress = 0;
      p.defuseProgress = 0;
      p.planting = false;
      p.defusing = false;
      p.hasBomb = false;
      if (!p.alive) this.resetLoadoutForNewRound(p);
      else this.persistLoadout(p);
      p.loadout.armor = p.armor; // giáp còn lại nếu sống
      this.spawnPlayer(p, p.spawnIndex);
    }
    // Giao bom cho người phe T đầu tiên
    const carrier = this.players.find((p) => p.team === 'T' && p.alive);
    if (carrier) carrier.hasBomb = true;
    this.events.push({ type: 'round_start', tick: this.tick, round: number });
    if (this.config.mode === 'deathmatch') return;
  }

  private persistLoadout(p: PlayerState): void {
    // Giữ vũ khí nếu sống; nếu không còn đạn thì vẫn giữ (người chơi có thể mua thêm).
    if (p.loadout.primary && p.ammo[p.loadout.primary]) {
      const w = this.data.weapon(p.loadout.primary);
      p.ammo[p.loadout.primary] = { mag: w.magazine, reserve: w.reserve };
    }
    if (p.loadout.secondary && p.ammo[p.loadout.secondary]) {
      const w = this.data.weapon(p.loadout.secondary);
      p.ammo[p.loadout.secondary] = { mag: w.magazine, reserve: w.reserve };
    }
    for (const g of GRENADE_KINDS) p.loadout.grenades[g] = 0;
    p.loadout.armor = Math.max(p.loadout.armor, p.armor);
  }

  private resetLoadoutForNewRound(p: PlayerState): void {
    const keepKit = p.loadout.defuseKit && p.team === 'CT';
    p.loadout = emptyLoadout(p.team);
    p.loadout.defuseKit = keepKit;
    const pistol = p.loadout.secondary!;
    const w = this.data.weapon(pistol);
    p.ammo = { [pistol]: { mag: w.magazine, reserve: w.reserve }, knife: { mag: 0, reserve: 0 } };
    p.armor = 0;
    p.helmet = false;
  }

  private swapSides(): void {
    for (const p of this.players) {
      p.team = OTHER[p.team];
      p.money = this.data.economy.startMoney;
      this.resetLoadoutForNewRound(p);
      p.loadout.armor = 0;
      p.hasBomb = false;
    }
    this.round.halftimeDone = true;
    this.round.lossStreakT = 0;
    this.round.lossStreakCT = 0;
  }

  private updateRespawn(p: PlayerState): void {
    if (p.alive || p.respawnAtTick <= 0 || this.tick < p.respawnAtTick) return;
    const respawnAllowed = this.round.phase === 'warmup'
      || this.config.mode === 'deathmatch' || this.config.mode === 'range';
    if (!respawnAllowed) return;
    p.alive = true;
    p.health = 100;
    p.armor = p.loadout.armor;
    const [x, y, z] = this.map.spawn(p.team, p.spawnIndex + this.tick % 3);
    p.x = x; p.y = y; p.z = z; p.vx = p.vy = p.vz = 0;
    p.respawnAtTick = 0;
    this.selectBestWeapon(p, true);
    this.events.push({ type: 'spawn', tick: this.tick, playerId: p.id });
  }

  private updatePlayer(p: PlayerState, cmd: InputCommand): void {
    const frozen = this.round.phase === 'freeze' || this.round.phase === 'over';
    // Góc nhìn: giới hạn tốc độ xoay mỗi tick để chống snap phi thực tế.
    const maxTurn = this.move.maxAngleDeltaPerTickDeg * DEG2RAD;
    const dYaw = clamp(angleDelta(p.yaw, cmd.yaw), -maxTurn, maxTurn);
    p.yaw = wrapAngle(p.yaw + dYaw);
    p.pitch = clamp(cmd.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    if (this.config.mode === 'range') { p.money = 16000; }

    const pressed = cmd.buttons & ~p.prevButtons;
    p.prevButtons = cmd.buttons;
    p.triggerWasDown = (cmd.buttons & Buttons.Fire) !== 0;

    const w = this.activeWeaponDef(p);

    // Đổi súng
    if (pressed & Buttons.SlotPrimary) this.switchSlot(p, 'primary');
    if (pressed & Buttons.SlotSecondary) this.switchSlot(p, 'secondary');
    if (pressed & Buttons.SlotKnife) this.switchSlot(p, 'knife');
    if (pressed & Buttons.SlotGrenade) this.switchSlot(p, 'grenade', cmd.grenadeSlot);

    // Ngắm scope
    if ((pressed & Buttons.Scope) && p.activeSlot !== 'grenade' && w.scopeFov > 0 && p.activeSlot !== 'knife') {
      p.scoped = !p.scoped;
      this.events.push({ type: 'scope', tick: this.tick, playerId: p.id, scoped: p.scoped });
    }

    // Nạp đạn
    if ((pressed & Buttons.Reload)) this.startReload(p);
    this.tickReload(p);

    // Di chuyển
    stepMovementSafe(p, cmd, this, frozen);

    // Dùng (đặt/gỡ bom, nhặt đồ) — ưu tiên hành động đang giữ
    this.handleUse(p, cmd, pressed);

    // Bắn / ném
    if (!frozen) this.handleAttack(p, cmd, pressed, w);

    // Rơi súng
    if ((pressed & Buttons.Drop)) this.dropActiveWeapon(p);

    // Hồi giật
    const resetTicks = Math.round(this.data.gameplay.combat.recoilResetSec * TICK_RATE);
    if (p.recoilShots > 0 && this.tick - p.lastShotTick > resetTicks) p.recoilShots = 0;

    // Tiếng bước chân
    this.updateFootsteps(p, w);

    // Hết chói dần
    if (p.blindUntilTick > 0 && this.tick >= p.blindUntilTick) { p.blindUntilTick = 0; p.flashIntensity = 0; }
  }

  private switchSlot(p: PlayerState, slot: 'primary' | 'secondary' | 'knife' | 'grenade', grenadeSlot = 0): void {
    if (slot === 'primary') {
      if (p.loadout.primary) this.setActiveWeapon(p, p.loadout.primary, 'primary');
      return;
    }
    if (slot === 'secondary') {
      if (p.loadout.secondary) this.setActiveWeapon(p, p.loadout.secondary, 'secondary');
      return;
    }
    if (slot === 'knife') { this.setActiveWeapon(p, 'knife', 'knife'); return; }
    // Lựu đạn: chọn loại còn đạn
    const kinds = GRENADE_KINDS.filter((g) => p.loadout.grenades[g] > 0);
    if (kinds.length === 0) return;
    const pick = kinds[grenadeSlot % kinds.length]!;
    p.activeSlot = 'grenade';
    p.activeGrenade = pick;
    p.scoped = false;
    p.reloadingUntilTick = 0;
    p.reloadingWeapon = null;
    p.drawingUntilTick = this.tick + 8;
  }

  private startReload(p: PlayerState): void {
    if (p.reloadingUntilTick > this.tick) return;
    if (p.activeSlot === 'knife' || p.activeSlot === 'grenade' || p.activeSlot === 'bomb') return;
    const w = this.activeWeaponDef(p);
    if (w.magazine <= 0) return;
    const ammo = this.ensureAmmo(p, p.activeWeapon);
    if (ammo.mag >= w.magazine || ammo.reserve <= 0) return;
    const empty = ammo.mag === 0;
    const ticks = w.shellReload
      ? Math.round((w.shellReloadTime ?? 0.55) * TICK_RATE)
      : this.data.reloadTicks(w, empty);
    p.reloadingUntilTick = this.tick + ticks;
    p.reloadingWeapon = p.activeWeapon;
    p.scoped = false;
    this.events.push({ type: 'reload_start', tick: this.tick, playerId: p.id, weapon: w.id, durationSec: ticks / TICK_RATE });
  }

  private tickReload(p: PlayerState): void {
    if (!p.reloadingWeapon || p.reloadingUntilTick <= 0) return;
    if (this.tick < p.reloadingUntilTick) return;
    const w = this.data.weapon(p.reloadingWeapon);
    const ammo = this.ensureAmmo(p, p.reloadingWeapon);
    if (w.shellReload) {
      const need = w.magazine - ammo.mag;
      if (need > 0 && ammo.reserve > 0) {
        ammo.mag++; ammo.reserve--;
      }
      if (ammo.mag < w.magazine && ammo.reserve > 0) {
        p.reloadingUntilTick = this.tick + Math.round((w.shellReloadTime ?? 0.55) * TICK_RATE);
        this.events.push({ type: 'reload_end', tick: this.tick, playerId: p.id, weapon: w.id });
        return;
      }
    } else {
      const need = Math.min(w.magazine - ammo.mag, ammo.reserve);
      ammo.mag += need; ammo.reserve -= need;
    }
    p.reloadingUntilTick = 0;
    p.reloadingWeapon = null;
    this.events.push({ type: 'reload_end', tick: this.tick, playerId: p.id, weapon: w.id });
  }

  private handleUse(p: PlayerState, cmd: InputCommand, pressed: number): void {
    const useHeld = (cmd.buttons & Buttons.Use) !== 0;
    const r = this.round;
    // Nhặt bom rơi
    if ((pressed & Buttons.Use) && p.team === 'T' && this.bombDropped && !r.bombPlanted) {
      const dx = p.x - this.bombDropX, dz = p.z - this.bombDropZ;
      if (dx * dx + dz * dz < 2.2 * 2.2) {
        p.hasBomb = true;
        this.bombDropped = false;
        this.events.push({ type: 'pickup', tick: this.tick, playerId: p.id, itemId: 'bomb' });
      }
    }
    // Đặt bom
    const site = this.map.siteAt(p.x, p.z);
    const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    const canPlant = p.team === 'T' && p.hasBomb && !r.bombPlanted && site !== null && p.grounded && speed < 0.75 && r.phase === 'live';
    if (canPlant && useHeld) {
      if (!p.planting) { p.planting = true; this.events.push({ type: 'plant_start', tick: this.tick, playerId: p.id }); }
      p.plantProgress += 1 / (this.data.plantTicks());
      if (p.plantProgress >= 1) this.plantBomb(p, site!);
    } else if (p.planting) {
      p.planting = false;
      p.plantProgress = 0;
    }
    // Gỡ bom
    let canDefuse = false;
    if (p.team === 'CT' && r.bombPlanted && r.phase === 'live' && p.grounded && speed < 0.75) {
      const dx = p.x - r.bombX, dz = p.z - r.bombZ;
      canDefuse = dx * dx + dz * dz < 1.9 * 1.9;
    }
    if (canDefuse && useHeld) {
      p.defusing = true;
      r.bombBeingDefusedBy = p.id;
      p.defuseKitActive = p.loadout.defuseKit;
      p.defuseProgress += 1 / this.data.defuseTicks(p.loadout.defuseKit);
      if (p.defuseProgress >= 1) this.defuseBomb(p);
    } else if (p.defusing) {
      p.defusing = false;
      p.defuseProgress = 0;
      if (r.bombBeingDefusedBy === p.id) r.bombBeingDefusedBy = null;
    }
    // Nhặt súng
    if ((pressed & Buttons.Use) && !p.planting && !p.defusing) this.tryPickupWeapon(p);
  }

  private plantBomb(p: PlayerState, site: 'A' | 'B'): void {
    const r = this.round;
    r.bombPlanted = true;
    r.bombSite = site;
    r.bombX = p.x; r.bombY = p.y + 0.1; r.bombZ = p.z;
    r.bombTimerEndTick = this.tick + Math.round(this.data.gameplay.round.bombTimeSec * TICK_RATE);
    r.bombBeingPlantedBy = null;
    p.hasBomb = false;
    p.planting = false;
    p.plantProgress = 0;
    this.bombPlanterId = p.id;
    this.nextBeepTick = this.tick + 8;
    this.events.push({ type: 'bomb_planted', tick: this.tick, site, x: p.x, y: p.y, z: p.z });
    // Bom nổ khi hết giờ; round không kết thúc bằng thời gian nữa.
    r.phaseEndTick = r.bombTimerEndTick + TICK_RATE * 5;
  }

  private defuseBomb(p: PlayerState): void {
    const r = this.round;
    r.bombPlanted = false;
    p.defusing = false;
    p.defuseProgress = 0;
    this.bombDefuserId = p.id;
    p.money = Math.min(this.data.economy.maxMoney, p.money + this.data.economy.defuseReward);
    this.events.push({ type: 'bomb_defused', tick: this.tick, playerId: p.id });
    this.endRound('CT', 'defuse');
  }

  private handleAttack(p: PlayerState, cmd: InputCommand, pressed: number, w: WeaponDef): void {
    if (p.reloadingUntilTick > this.tick || p.drawingUntilTick > this.tick) return;
    const held = (cmd.buttons & Buttons.Fire) !== 0;
    if (this.tick < p.nextAttackTick) return;
    if (p.activeSlot === 'grenade') {
      const strong = (pressed & Buttons.Fire) !== 0;
      const weak = (pressed & Buttons.Scope) !== 0;
      if (!strong && !weak) return;
      this.throwGrenade(p, weak);
      return;
    }
    if (p.activeSlot === 'knife') {
      if ((pressed & Buttons.Fire) !== 0) this.knifeAttack(p);
      return;
    }
    if (!p.alive) return;
    if (w.fireMode === 'auto' || w.fireMode === 'pump') {
      if (!held) return;
    } else if ((pressed & Buttons.Fire) === 0) {
      return;
    }
    const ammo = this.ensureAmmo(p, w.id);
    if (ammo.mag <= 0) {
      this.events.push({ type: 'dryfire', tick: this.tick, playerId: p.id });
      p.nextAttackTick = this.tick + Math.round(TICK_RATE * 0.3);
      return;
    }
    ammo.mag--;
    const interval = this.data.fireIntervalTicks(w);
    p.nextAttackTick = this.tick + interval;
    p.lastAttackTick = this.tick;
    p.lastShotTick = this.tick;
    p.recoilShots = Math.min(p.recoilShots + 1, 60);
    this.fireHitscan(p, w, cmd);
  }

  private fireHitscan(p: PlayerState, w: WeaponDef, cmd: InputCommand): void {
    const originX = p.x, originY = p.eyeY - (p.crouching ? 0.04 : 0.02), originZ = p.z;
    const dir = { yaw: 0, pitch: 0 };
    const damageBase = w.damage;
    const pellets = Math.max(1, w.pellets);
    const maxDist = w.range;
    const rewind = clamp(cmd.viewTick ?? this.tick, this.tick - Math.round(this.data.gameplay.combat.maxLagCompMs / 1000 * TICK_RATE), this.tick);
    let firstDir = { x: 0, y: 0, z: 0 };
    for (let pellet = 0; pellet < pellets; pellet++) {
      computeShotDirection(p, w, this.rng, this.data, dir);
      const d = lookDir(dir.yaw, dir.pitch, { x: 0, y: 0, z: 0 });
      if (pellet === 0) firstDir = { x: d.x, y: d.y, z: d.z };
      this.traceBullet(p, w, originX, originY, originZ, d.x, d.y, d.z, maxDist, damageBase, rewind);
    }
    this.events.push({
      type: 'shot', tick: this.tick, playerId: p.id, weapon: w.id,
      x: originX, y: originY, z: originZ, dx: firstDir.x, dy: firstDir.y, dz: firstDir.z,
    });
  }

  private traceBullet(
    attacker: PlayerState, w: WeaponDef,
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
    maxDist: number, damage: number, rewindTick: number,
  ): void {
    let remaining = damage;
    let originX = ox, originY = oy, originZ = oz;
    let remainingDist = maxDist;
    let penetrations = 0;
    const maxPen = this.data.gameplay.combat.maxPenetrations;
    for (let attempt = 0; attempt <= maxPen; attempt++) {
      this.collision.raycastBullet(originX, originY, originZ, dx, dy, dz, remainingDist, this.bulletHits);
      const wallHit = this.bulletHits[0] ?? null;
      const wallDist = wallHit ? wallHit.t : remainingDist;
      const playerHit = this.findPlayerOnRay(attacker, originX, originY, originZ, dx, dy, dz, wallDist, rewindTick);
      if (playerHit) {
        const distance = distVec3({ x: originX, y: originY, z: originZ }, { x: playerHit.x, y: playerHit.y, z: playerHit.z });
        const dmg = rangeAdjustedDamage(remaining, distance, w.rangeModifier)
          * (penetrations > 0 ? Math.pow(this.data.gameplay.combat.penetrationDamageFalloff, penetrations) : 1);
        this.damagePlayer(playerHit.victim, attacker, dmg, playerHit.group, w, playerHit.x, playerHit.y, playerHit.z, w.category);
        return;
      }
      if (!wallHit) return;
      this.events.push({
        type: 'impact', tick: this.tick, x: wallHit.x, y: wallHit.y, z: wallHit.z,
        nx: wallHit.nx, ny: wallHit.ny, nz: wallHit.nz, material: wallHit.collider.material,
      });
      this.carveSmokeAlongBullet(originX, originY, originZ, dx, dy, dz, wallHit.t);
      if (wallHit.collider.penetration <= 0 || penetrations >= maxPen) return;
      // Xuyên qua vật mỏng: dịch qua bề dày theo hướng bắn.
      const thickness = Math.min(0.9, this.colliderThickness(wallHit.collider, dx, dy, dz));
      const advance = wallHit.t + thickness + 0.06;
      originX += dx * advance; originY += dy * advance; originZ += dz * advance;
      remainingDist -= advance;
      if (remainingDist <= 0.2) return;
      remaining *= 0.82;
      penetrations++;
    }
  }

  private carveSmokeAlongBullet(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, dist: number): void {
    for (const s of this.smokes) {
      if (!s.active || !s.voxels) continue;
      const steps = Math.min(12, Math.max(3, Math.ceil(dist / 2)));
      for (let i = 0; i <= steps; i++) {
        const t = (dist * i) / steps;
        const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
        const ddx = px - s.x, ddy = py - s.y, ddz = pz - s.z;
        if (ddx * ddx + ddy * ddy + ddz * ddz <= s.radius * s.radius) {
          carveSmokeHole(s, px, py, pz, this.data.gameplay.smoke.bulletHoleRadiusM, this.data.gameplay.smoke);
          break;
        }
      }
    }
  }

  private colliderThickness(c: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }, dx: number, dy: number, dz: number): number {
    const tx = Math.abs(dx) > 1e-6 ? (c.maxX - c.minX) / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 1e-6 ? (c.maxY - c.minY) / Math.abs(dy) : Infinity;
    const tz = Math.abs(dz) > 1e-6 ? (c.maxZ - c.minZ) / Math.abs(dz) : Infinity;
    return Math.min(tx, ty, tz);
  }

  private findPlayerOnRay(
    attacker: PlayerState, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
    maxDist: number, rewindTick: number,
  ): { victim: PlayerState; group: HitboxGroup; x: number; y: number; z: number } | null {
    let best: { victim: PlayerState; group: HitboxGroup; t: number } | null = null;
    for (const p of this.players) {
      if (p.id === attacker.id || !p.alive) continue;
      if (p.team === attacker.team && !this.data.gameplay.combat.friendlyFire) continue;
      const hb = this.history.getAt(p.id, rewindTick) ?? computeHitboxes(p, this.playerHitboxScratch);
      const hit = hitboxGroupAt(hb, ox, oy, oz, dx, dy, dz, maxDist);
      if (hit && (!best || hit.t < best.t)) best = { victim: p, group: hit.group, t: hit.t };
    }
    if (!best) return null;
    return {
      victim: best.victim, group: best.group,
      x: ox + dx * best.t, y: oy + dy * best.t, z: oz + dz * best.t,
    };
  }

  damagePlayer(
    victim: PlayerState, attacker: PlayerState | null, rawDamage: number, group: HitboxGroup,
    w: WeaponDef, hx: number, hy: number, hz: number, killCategory: WeaponCategory,
    killWeaponId: string = w.id,
  ): void {
    if (!victim.alive || rawDamage <= 0) return;
    if (attacker && attacker.id === victim.id && !this.data.gameplay.combat.selfDamage) return;
    const res = computeDamage(victim, rawDamage, group, w, this.data);
    victim.health = Math.max(0, victim.health - res.healthDamage);
    victim.armor = Math.max(0, victim.armor - res.armorDamage);
    victim.lastDamagedBy = attacker?.id ?? null;
    victim.lastDamageTick = this.tick;
    victim.assistCreditUntilTick = this.tick + TICK_RATE * 10;
    if (attacker) attacker.damageDealt += res.actualDamage;
    this.events.push({
      type: 'hit', tick: this.tick, attacker: attacker?.id ?? -1, victim: victim.id,
      damage: res.actualDamage, group, x: hx, y: hy, z: hz, nx: 0, ny: 0, nz: 0, lethal: res.lethal,
    });
    this.events.push({ type: 'damage', tick: this.tick, victim: victim.id, amount: res.actualDamage, attacker: attacker?.id ?? null });
    if (res.lethal) this.killPlayer(victim, attacker, killWeaponId, group === 'head', killCategory);
  }

  private killPlayer(victim: PlayerState, attacker: PlayerState | null, weaponId: string, headshot: boolean, category: WeaponCategory): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.deaths++;
    victim.health = 0;
    victim.planting = false;
    victim.defusing = false;
    victim.plantProgress = 0;
    victim.defuseProgress = 0;
    victim.vx = victim.vy = victim.vz = 0;
    victim.mvmtState = 'idle';
    if (victim.hasBomb) {
      victim.hasBomb = false;
      this.bombDropped = true;
      this.bombDropX = victim.x; this.bombDropY = victim.y + 0.2; this.bombDropZ = victim.z;
      this.events.push({ type: 'bomb_dropped', tick: this.tick, x: victim.x, y: victim.y, z: victim.z });
    }
    // Rơi vũ khí
    if (victim.loadout.primary) {
      const a = victim.ammo[victim.loadout.primary];
      this.dropped.push({
        id: this.nextDropId++, weaponId: victim.loadout.primary,
        x: victim.x, y: victim.y + 0.1, z: victim.z,
        ammo: a?.mag ?? 0, reserve: a?.reserve ?? 0, dropTick: this.tick,
      });
      victim.loadout.primary = null;
    }
    let reward = 0;
    if (attacker && attacker.id !== victim.id) {
      if (attacker.team === victim.team) {
        attacker.money = Math.max(0, attacker.money + this.data.economy.teamkillPenalty);
        attacker.kills = Math.max(0, attacker.kills - 1);
      } else {
        attacker.kills++;
        reward = this.data.economy.killRewardsByCategory[category] ?? 300;
        attacker.money = Math.min(this.data.economy.maxMoney, attacker.money + reward);
        // Hỗ trợ: người gây sát thương gần nhất
        const assisterId = victim.lastDamagedBy;
        if (assisterId !== null && assisterId !== attacker.id) {
          const assister = this.byId.get(assisterId);
          if (assister && assister.team === attacker.team) assister.assists++;
        }
      }
    } else if (attacker && attacker.id === victim.id) {
      victim.money = Math.max(0, victim.money + this.data.economy.suicidePenalty);
    }
    this.events.push({
      type: 'kill', tick: this.tick, attacker: attacker?.id ?? null, victim: victim.id,
      weapon: weaponId, headshot, x: victim.x, y: victim.y, z: victim.z,
    });
    if (this.round.phase === 'warmup' || this.config.mode === 'deathmatch' || this.config.mode === 'range') {
      victim.respawnAtTick = this.tick + Math.round(1.4 * TICK_RATE);
    }
  }

  private knifeAttack(p: PlayerState): void {
    const w = this.data.weapon('knife');
    p.nextAttackTick = this.tick + Math.round(60 / w.rpm * TICK_RATE);
    p.lastAttackTick = this.tick;
    const d = lookDir(p.yaw, p.pitch, { x: 0, y: 0, z: 0 });
    const origin = { x: p.x, y: p.eyeY - 0.05, z: p.z };
    const end = { x: origin.x + d.x * 2.2, y: origin.y + d.y * 2.2, z: origin.z + d.z * 2.2 };
    if (!this.collision.segmentClear(origin.x, origin.y, origin.z, end.x, end.y, end.z)) {
      // Có vật cản: vẫn có thể trúng nếu rất gần, nhưng đơn giản hoá là không trúng.
      this.events.push({ type: 'shot', tick: this.tick, playerId: p.id, weapon: 'knife', x: origin.x, y: origin.y, z: origin.z, dx: d.x, dy: d.y, dz: d.z });
      return;
    }
    let best: PlayerState | null = null;
    let bestDist = 2.2;
    for (const v of this.players) {
      if (!v.alive || v.id === p.id) continue;
      if (v.team === p.team && !this.data.gameplay.combat.friendlyFire) continue;
      const hb = computeHitboxes(v, this.playerHitboxScratch);
      const hit = hitboxGroupAt(hb, origin.x, origin.y, origin.z, d.x, d.y, d.z, bestDist);
      if (hit && hit.t < bestDist) { bestDist = hit.t; best = v; }
    }
    this.events.push({ type: 'shot', tick: this.tick, playerId: p.id, weapon: 'knife', x: origin.x, y: origin.y, z: origin.z, dx: d.x, dy: d.y, dz: d.z });
    if (best) {
      const back = isBackstab(p, best);
      const dmg = back ? (w.backstabDamage ?? 65) : w.damage;
      const hx = origin.x + d.x * bestDist, hy = origin.y + d.y * bestDist, hz = origin.z + d.z * bestDist;
      this.damagePlayer(best, p, dmg, 'chest', w, hx, hy, hz, 'knife');
    }
  }

  private throwGrenade(p: PlayerState, weak: boolean): void {
    const kind = p.activeGrenade;
    if (!kind) return;
    if (p.loadout.grenades[kind] <= 0) return;
    const g = this.data.grenade(kind);
    p.loadout.grenades[kind]--;
    p.nextAttackTick = this.tick + Math.round(0.45 * TICK_RATE);
    const speed = weak ? g.throwSpeedWeak : g.throwSpeed;
    const [vx, vy, vz] = throwVelocity(p.yaw, p.pitch, speed, 0.35);
    this.grenades.push({
      id: this.nextEntityId++, kind, ownerId: p.id, team: p.team,
      x: p.x + Math.sin(p.yaw) * 0.35, y: p.eyeY - 0.12, z: p.z + Math.cos(p.yaw) * 0.35,
      vx, vy, vz, spawnTick: this.tick, fuseTick: this.tick + Math.round(g.fuse * TICK_RATE),
      detonated: false, bounces: 0,
    });
    this.events.push({ type: 'grenade_throw', tick: this.tick, playerId: p.id, kind, weak });
    // Chọn quả kế tiếp
    const next = GRENADE_KINDS.find((k) => p.loadout.grenades[k] > 0);
    if (next) p.activeGrenade = next;
    else this.selectBestWeapon(p, true);
  }

  private updateGrenades(): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]!;
      if (g.detonated) { this.grenades.splice(i, 1); continue; }
      if (this.tick >= g.fuseTick) {
        this.detonateGrenade(g);
        this.grenades.splice(i, 1);
        continue;
      }
      const ground = stepGrenade(g, 1 / TICK_RATE, this.collision, this.move.gravity);
      if ((g.kind === 'molotov' || g.kind === 'incendiary') && (ground || g.bounces > 0)) {
        this.detonateGrenade(g);
        this.grenades.splice(i, 1);
      }
    }
  }

  private detonateGrenade(g: GrenadeProjectile): void {
    g.detonated = true;
    const def = this.data.grenade(g.kind);
    const owner = this.byId.get(g.ownerId) ?? null;
    this.events.push({ type: 'grenade_explode', tick: this.tick, kind: g.kind, x: g.x, y: g.y, z: g.z });
    if (g.kind === 'he') {
      this.applyExplosionDamage(g.x, g.y, g.z, def.radius, def.damage, owner, g.team, 'he', g.kind);
      for (const s of this.smokes) {
        if (!s.active) continue;
        const dx = s.x - g.x, dy = s.y - g.y, dz = s.z - g.z;
        if (dx * dx + dy * dy + dz * dz < (def.radius + s.radius) ** 2) {
          carveSmokeHole(s, g.x, g.y, g.z, this.data.gameplay.smoke.heHoleRadiusM, this.data.gameplay.smoke);
        }
      }
    } else if (g.kind === 'flash') {
      this.applyFlash(g.x, g.y, g.z, def.radius, def.maxBlindSec ?? 4.6);
    } else if (g.kind === 'smoke') {
      const duration = (def.duration ?? this.data.gameplay.smoke.durationSec) * TICK_RATE;
      const groundY = this.collision.floorHeightAt(g.x, g.z, g.y + 1);
      const centerY = (groundY > -Infinity ? groundY : 0) + def.radius * 0.55;
      const vol = createSmokeVolume(
        this.nextEntityId++, g.x, centerY, g.z, def.radius, this.tick + 1,
        this.tick + duration, this.data.gameplay.smoke,
      );
      this.smokes.push(vol);
      this.events.push({ type: 'smoke_start', tick: this.tick, x: vol.x, y: vol.y, z: vol.z, radius: vol.radius });
      // Khói dập lửa
      for (const f of this.fires) {
        const dx = f.x - g.x, dz = f.z - g.z;
        if (dx * dx + dz * dz < (def.radius + f.radius) ** 2) f.endTick = this.tick;
      }
    } else if (g.kind === 'molotov' || g.kind === 'incendiary') {
      const duration = (def.duration ?? 7) * TICK_RATE;
      const y = this.collision.floorHeightAt(g.x, g.z, g.y + 1);
      const fy = y > -Infinity ? y : Math.max(0, g.y - 0.3);
      this.fires.push({
        id: this.nextEntityId++, x: g.x, z: g.z, radius: def.radius,
        startTick: this.tick, endTick: this.tick + duration, ownerId: g.ownerId, team: g.team,
      });
      this.events.push({ type: 'fire_start', tick: this.tick, x: g.x, y: fy, z: g.z, radius: def.radius });
    }
  }

  private applyExplosionDamage(
    x: number, y: number, z: number, radius: number, maxDamage: number,
    owner: PlayerState | null, team: Team, weaponId: string, _kind: string,
  ): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.team === team && !this.data.gameplay.combat.friendlyFire) continue;
      const dx = p.x - x, dy = p.eyeY - y, dz = p.z - z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > radius) continue;
      const exposed = this.collision.segmentClear(x, y, z, p.x, p.eyeY, p.z) ? 1 : 0.35;
      const dmg = maxDamage * (1 - dist / radius) * exposed;
      if (dmg <= 0) continue;
      // Vụ nổ dùng hệ số giáp của súng lục gần nhất trong dữ liệu; mã vũ khí cho killfeed là grenade.
      const w = this.data.weapon('pistol_t');
      this.damagePlayer(p, owner, dmg, 'chest', w, p.x, p.eyeY, p.z, 'pistol', weaponId);
    }
  }

  private applyFlash(x: number, y: number, z: number, radius: number, maxBlindSec: number): void {
    const flashDef = this.data.gameplay.flash;
    for (const p of this.players) {
      if (!p.alive) continue;
      const dx = x - p.x, dy = y - p.eyeY, dz = z - p.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > radius) continue;
      if (!this.collision.segmentClear(p.x, p.eyeY, p.z, x, y, z)) continue;
      const look = lookDir(p.yaw, p.pitch, { x: 0, y: 0, z: 0 });
      const inv = 1 / Math.max(0.001, dist);
      const dot = clamp((dx * inv) * look.x + (dy * inv) * look.y + (dz * inv) * look.z, -1, 1);
      const angleFactor = (dot + 1) * 0.5;
      const distanceFactor = 1 - dist / radius;
      const intensity = clamp(distanceFactor * (1 - flashDef.angleWeight + flashDef.angleWeight * angleFactor), 0, 1);
      const sec = Math.max(flashDef.minBlindSec, maxBlindSec * Math.pow(intensity, 0.65));
      const until = this.tick + Math.round(sec * TICK_RATE);
      if (until > p.blindUntilTick) { p.blindUntilTick = until; p.flashIntensity = intensity; }
      this.events.push({ type: 'flash', tick: this.tick, x, y, z, playerId: p.id });
    }
  }

  private updateVolumes(): void {
    // Khói hết hạn
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i]!;
      if (!s.active) continue;
      if (this.tick >= s.endTick) {
        s.active = false;
        this.events.push({ type: 'smoke_end', tick: this.tick, x: s.x, y: s.y, z: s.z });
        this.smokes.splice(i, 1);
      }
    }
    // Lửa
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i]!;
      if (this.tick >= f.endTick) { this.fires.splice(i, 1); continue; }
      if (this.tick % 8 !== 0) continue;
      for (const p of this.players) {
        if (!p.alive) continue;
        if (p.team === f.team && !this.data.gameplay.combat.friendlyFire) continue;
        const dx = p.x - f.x, dz = p.z - f.z;
        if (dx * dx + dz * dz > f.radius * f.radius) continue;
        const owner = this.byId.get(f.ownerId) ?? null;
        const w = this.data.weapon('knife');
        this.damagePlayer(p, owner, (this.data.grenade('molotov').dps ?? 22) * (8 / TICK_RATE), 'legs', w, p.x, p.y, p.z, 'pistol', 'molotov');
      }
    }
  }

  private updateBomb(): void {
    const r = this.round;
    if (!r.bombPlanted || r.phase !== 'live') return;
    if (this.tick >= r.bombTimerEndTick) {
      this.events.push({ type: 'bomb_exploded', tick: this.tick, x: r.bombX, y: r.bombY, z: r.bombZ });
      const def = this.data.gameplay.round;
      for (const p of this.players) {
        if (!p.alive) continue;
        const dist = distVec3({ x: p.x, y: p.eyeY, z: p.z }, { x: r.bombX, y: r.bombY, z: r.bombZ });
        if (dist > def.bombDamageRadius) continue;
        const dmg = def.bombDamage * (1 - dist / def.bombDamageRadius);
        p.health -= dmg;
        p.lastDamageTick = this.tick;
        this.events.push({ type: 'damage', tick: this.tick, victim: p.id, amount: dmg, attacker: null });
        if (p.health <= 0) {
          p.health = 0;
          this.killPlayer(p, null, 'bomb', false, 'rifle');
        }
      }
      this.endRound('T', 'bomb');
      return;
    }
    if (this.tick >= this.nextBeepTick) {
      const total = this.data.gameplay.round.bombTimeSec * TICK_RATE;
      const remain = Math.max(0, r.bombTimerEndTick - this.tick);
      const frac = 1 - remain / total;
      const interval = this.data.gameplay.bomb.beepIntervalStartSec
        + (this.data.gameplay.bomb.beepIntervalEndSec - this.data.gameplay.bomb.beepIntervalStartSec) * frac;
      this.nextBeepTick = this.tick + Math.max(4, Math.round(interval * TICK_RATE));
      this.events.push({ type: 'bomb_beep', tick: this.tick, x: r.bombX, y: r.bombY, z: r.bombZ, rate: frac });
    }
  }

  private updateFootsteps(p: PlayerState, w: WeaponDef): void {
    if (!p.grounded) return;
    const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    if (speed < 0.8) return;
    const quiet = p.walking || p.crouching || w.category === 'knife' && speed < 1.5;
    if (quiet) return;
    const interval = speed > 3.3 ? Math.round(0.33 * TICK_RATE) : Math.round(0.45 * TICK_RATE);
    if (this.tick - p.lastFootstepTick < interval) return;
    p.lastFootstepTick = this.tick;
    this.events.push({
      type: 'footstep', tick: this.tick, playerId: p.id, x: p.x, y: p.y, z: p.z,
      material: this.floorMaterial(p.x, p.z),
    });
  }

  private floorMaterial(x: number, z: number): string {
    const cell = this.map.cellAtWorld(x, z);
    if (cell === 'x' || cell === 'X') return 'metal';
    if (cell === 'h') return 'concrete';
    return this.map.json.environment.theme === 'desert' ? 'sand' : 'concrete';
  }

  private dropActiveWeapon(p: PlayerState): void {
    let weaponId: string | null = null;
    if (p.activeSlot === 'primary') weaponId = p.loadout.primary;
    else if (p.activeSlot === 'secondary') weaponId = p.loadout.secondary;
    if (!weaponId || weaponId === 'knife') return;
    const a = p.ammo[weaponId];
    this.dropped.push({
      id: this.nextDropId++, weaponId, x: p.x, y: p.y + 0.1, z: p.z,
      ammo: a?.mag ?? 0, reserve: a?.reserve ?? 0, dropTick: this.tick,
    });
    if (p.activeSlot === 'primary') p.loadout.primary = null;
    else p.loadout.secondary = null;
    this.selectBestWeapon(p, true);
    this.events.push({ type: 'pickup', tick: this.tick, playerId: p.id, itemId: weaponId });
  }

  private tryPickupWeapon(p: PlayerState): void {
    if (p.activeSlot === 'grenade') return;
    let bestIdx = -1;
    let bestDist = 1.8;
    for (let i = 0; i < this.dropped.length; i++) {
      const d = this.dropped[i]!;
      const dx = p.x - d.x, dz = p.z - d.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx < 0) return;
    const d = this.dropped[bestIdx]!;
    const w = this.data.weapon(d.weaponId);
    // Nếu slot đã có súng, thả súng cũ
    if (w.slot === 'primary' && p.loadout.primary) {
      const old = p.loadout.primary;
      const a = p.ammo[old];
      this.dropped.push({
        id: this.nextDropId++, weaponId: old, x: p.x, y: p.y + 0.1, z: p.z,
        ammo: a?.mag ?? 0, reserve: a?.reserve ?? 0, dropTick: this.tick,
      });
    } else if (w.slot === 'secondary' && p.loadout.secondary) {
      const old = p.loadout.secondary;
      if (old !== 'knife') {
        const a = p.ammo[old];
        this.dropped.push({
          id: this.nextDropId++, weaponId: old, x: p.x, y: p.y + 0.1, z: p.z,
          ammo: a?.mag ?? 0, reserve: a?.reserve ?? 0, dropTick: this.tick,
        });
      }
    }
    if (w.slot === 'primary') p.loadout.primary = d.weaponId;
    else p.loadout.secondary = d.weaponId;
    p.ammo[d.weaponId] = { mag: d.ammo, reserve: d.reserve };
    this.dropped.splice(bestIdx, 1);
    this.setActiveWeapon(p, d.weaponId, w.slot === 'primary' ? 'primary' : 'secondary');
    this.events.push({ type: 'pickup', tick: this.tick, playerId: p.id, itemId: d.weaponId });
  }

  private checkRoundEnd(): void {
    const r = this.round;
    if (r.phase !== 'live') return;
    if (this.config.mode === 'range' || this.config.mode === 'deathmatch') return;
    if (r.bombPlanted) {
      if (this.aliveCount('CT') === 0) { this.endRound('T', 'elimination'); return; }
      return;
    }
    if (this.aliveCount('T') === 0) { this.endRound('CT', 'elimination'); return; }
    if (this.aliveCount('CT') === 0) { this.endRound('T', 'elimination'); return; }
  }

  private endRound(winner: Team, reason: RoundState['winReason']): void {
    const r = this.round;
    if (r.phase !== 'live') return;
    r.phase = 'over';
    r.phaseEndTick = this.tick + Math.round(this.data.gameplay.round.postRoundSec * TICK_RATE);
    r.winner = winner;
    r.winReason = reason;
    if (winner === 'T') { r.scoreT++; r.lossStreakT = 0; r.lossStreakCT = Math.min(4, r.lossStreakCT + 1); }
    else { r.scoreCT++; r.lossStreakCT = 0; r.lossStreakT = Math.min(4, r.lossStreakT + 1); }

    const eco = this.data.economy;
    for (const p of this.players) {
      if (!p.connected) continue;
      if (p.team === winner) {
        p.money = Math.min(eco.maxMoney, p.money + eco.winReward);
      } else {
        const streak = p.team === 'T' ? r.lossStreakT : r.lossStreakCT;
        const reward = Math.min(eco.lossMax, eco.lossBase + eco.lossStep * Math.max(0, streak - 1));
        p.money = Math.min(eco.maxMoney, p.money + reward);
      }
      if (r.bombPlanted && p.id === this.bombPlanterId) p.money = Math.min(eco.maxMoney, p.money + eco.plantReward);
      if (this.config.mode === 'range') p.money = 16000;
    }
    this.events.push({
      type: 'round_end', tick: this.tick, winner, reason: reason ?? 'elimination',
      scoreT: r.scoreT, scoreCT: r.scoreCT,
    });

    const otTarget = this.config.roundsToWin + 3 * r.overtimeBlock;
    const target = r.overtime ? otTarget : this.config.roundsToWin;
    if (r.scoreT >= target || r.scoreCT >= target) {
      this.finished = true;
      this.events.push({ type: 'match_end', tick: this.tick, winner });
    } else if (r.roundNumber >= this.config.maxRounds + 6 * r.overtimeBlock) {
      if (r.scoreT === r.scoreCT) {
        if (!this.config.overtimeEnabled) {
          this.finished = true;
          this.events.push({ type: 'match_end', tick: this.tick, winner });
        } else {
          r.overtime = true;
          r.overtimeBlock++;
          for (const p of this.players) p.money = this.data.gameplay.round.overtimeStartMoney;
        }
      } else {
        this.finished = true;
        this.events.push({ type: 'match_end', tick: this.tick, winner: r.scoreT > r.scoreCT ? 'T' : 'CT' });
      }
    }
  }

  buy(playerId: PlayerId, itemId: string): BuyResult {
    const p = this.byId.get(playerId);
    if (!p) return { ok: false, reason: 'no_player' };
    if (this.round.phase !== 'freeze' && this.round.phase !== 'live') return { ok: false, reason: 'buy_closed' };
    if (this.round.phase === 'live') {
      const elapsed = this.tick - this.round.roundStartTick;
      if (elapsed > this.data.gameplay.round.buyTimeSec * TICK_RATE) return { ok: false, reason: 'buy_time_over' };
    }
    if (!this.config.mode.match(/range|deathmatch/) && !this.map.inBuyZone(p.team, p.x, p.z)) return { ok: false, reason: 'not_in_buy_zone' };
    const item = this.data.buyItem(itemId);
    if (!item) return { ok: false, reason: 'unknown_item' };
    if (item.team !== 'both' && item.team !== p.team) return { ok: false, reason: 'wrong_team' };
    if (!this.config.mode.match(/range|deathmatch/) && p.money < item.price) return { ok: false, reason: 'not_enough_money' };

    if (item.kind === 'weapon') {
      const w = this.data.weapon(item.ref);
      if (!this.config.mode.match(/range|deathmatch/)) p.money -= item.price;
      if (w.slot === 'primary') {
        if (p.loadout.primary) this.dropExisting(p, p.loadout.primary);
        p.loadout.primary = w.id;
      } else {
        if (p.loadout.secondary) this.dropExisting(p, p.loadout.secondary);
        p.loadout.secondary = w.id;
      }
      p.ammo[w.id] = { mag: w.magazine, reserve: w.reserve };
      p.armor = Math.max(0, p.armor);
      this.setActiveWeapon(p, w.id, w.slot === 'primary' ? 'primary' : 'secondary');
    } else if (item.kind === 'armor' || item.kind === 'helmet') {
      if (item.kind === 'helmet' && p.armor <= 0) return { ok: false, reason: 'need_armor' };
      if (!this.config.mode.match(/range|deathmatch/)) p.money -= item.price;
      if (item.kind === 'armor') { p.armor = 100; p.loadout.armor = 100; }
      else { p.helmet = true; p.loadout.helmet = true; }
    } else if (item.kind === 'kit') {
      if (p.team !== 'CT') return { ok: false, reason: 'wrong_team' };
      if (!this.config.mode.match(/range|deathmatch/)) p.money -= item.price;
      p.loadout.defuseKit = true;
    } else if (item.kind === 'grenade') {
      const g = this.data.grenade(item.ref as GrenadeKind);
      const owned = p.loadout.grenades[g.id];
      if (owned >= g.maxCarry) return { ok: false, reason: 'max_carry' };
      if (!this.config.mode.match(/range|deathmatch/)) p.money -= item.price;
      p.loadout.grenades[g.id] = owned + 1;
    }
    this.events.push({ type: 'buy', tick: this.tick, playerId: p.id, itemId });
    return { ok: true };
  }

  private dropExisting(p: PlayerState, weaponId: string): void {
    if (weaponId === 'knife') return;
    const a = p.ammo[weaponId];
    this.dropped.push({
      id: this.nextDropId++, weaponId, x: p.x, y: p.y + 0.1, z: p.z,
      ammo: a?.mag ?? 0, reserve: a?.reserve ?? 0, dropTick: this.tick,
    });
  }

  private cleanupRoundState(): void {
    // Dọn rác rơi quá lâu để tránh phình bộ nhớ
    const maxAge = TICK_RATE * 60;
    while (this.dropped.length > 64) this.dropped.shift();
    for (let i = this.dropped.length - 1; i >= 0; i--) {
      if (this.tick - this.dropped[i]!.dropTick > maxAge) this.dropped.splice(i, 1);
    }
    if (this.events.length > 512) this.events.length = 512;
  }

  // ---- Truy vấn cho netcode / bot ----

  eyeOf(p: PlayerState): { x: number; y: number; z: number } {
    return { x: p.x, y: p.eyeY, z: p.z };
  }

  canSeePoint(from: PlayerState, tx: number, ty: number, tz: number): boolean {
    const ex = from.x, ey = from.eyeY, ez = from.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.01) return true;
    if (this.collision.raycastSight(ex, ey, ez, dx / len, dy / len, dz / len, len)) return false;
    if (this.isSegmentSmoked(ex, ey, ez, tx, ty, tz)) return false;
    return true;
  }

  canSee(from: PlayerState, target: PlayerState): boolean {
    if (!target.alive) return false;
    return this.canSeePoint(from, target.x, target.eyeY, target.z)
      || this.canSeePoint(from, target.x, target.y + 1.2, target.z)
      || this.canSeePoint(from, target.x, target.y + 0.85, target.z);
  }

  isSegmentSmoked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    for (const s of this.smokes) {
      if (!s.active) continue;
      if (smokeBlocksSegment(s, ax, ay, az, bx, by, bz, this.data.gameplay.smoke)) return true;
    }
    return false;
  }

  isBlinded(p: PlayerState): boolean { return this.tick < p.blindUntilTick; }

  enemyVisibleFrom(observer: PlayerState, target: PlayerState): boolean {
    if (observer.team === target.team) return false;
    if (!target.alive || !observer.alive) return false;
    if (this.isBlinded(observer)) return false;
    return this.canSee(observer, target);
  }

  smokeVolumeAt(x: number, y: number, z: number): SmokeVolume | null {
    for (const s of this.smokes) {
      if (!s.active) continue;
      const dx = x - s.x, dy = y - s.y, dz = z - s.z;
      if (dx * dx + dy * dy + dz * dz <= s.radius * s.radius) return s;
    }
    return null;
  }

  /** Server phát sự kiện âm thanh thô, không gửi vị trí chính xác cho client địch. */
  quantizeSoundPosition(x: number, z: number): [number, number] {
    return [Math.round(x / 2) * 2, Math.round(z / 2) * 2];
  }

  getSnapshotIntervalTicks(): number { return TICK_RATE / SNAPSHOT_RATE; }

  /** Trạng thái công khai cho client/bot (không lộ vị trí địch ngoài tầm nhìn). */
  publicPlayers(): PlayerState[] { return this.players; }

  hitboxesAt(playerId: PlayerId, tick: number): HitboxState | null {
    return this.history.getAt(playerId, tick);
  }

  // Tuỳ chọn cho test
  forceTick(n: number): void { this.tick = n; }
}

/** Gọi movement với ngữ cảnh sim. */
function stepMovementSafe(p: PlayerState, cmd: InputCommand, sim: MatchSim, frozen: boolean): void {
  stepMovement(p, cmd, 1 / TICK_RATE, { world: sim.collision, move: sim.move, data: sim.data }, frozen);
}

export function hitboxFromArray(arr: Float32Array, offset: number): HitboxState {
  return arrayToHitbox(arr, offset, emptyHitbox());
}
