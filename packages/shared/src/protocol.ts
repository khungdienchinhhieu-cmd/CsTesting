// Giao thức nhị phân: lượng tử hoá + bit-packing + delta snapshot.
// Mọi giá trị ảnh hưởng gameplay do server gửi; client không bao giờ gửi vị trí/kết quả bắn.
import type { GameData } from './data';
import type { GameEvent, GrenadeKind, Team } from './types';
import type { RoundPhase } from './types';

export const PROTOCOL_VERSION = 1;

export class BitWriter {
  private buf: Uint8Array;
  private bitPos = 0;
  constructor(capacityBytes = 4096) { this.buf = new Uint8Array(capacityBytes); }
  private ensure(bits: number): void {
    const need = Math.ceil((this.bitPos + bits) / 8);
    if (need > this.buf.length) {
      let size = this.buf.length * 2;
      while (size < need) size *= 2;
      const next = new Uint8Array(size);
      next.set(this.buf);
      this.buf = next;
    }
  }
  writeBits(value: number, bits: number): void {
    if (bits <= 0) return;
    this.ensure(bits);
    const v = value >>> 0;
    for (let i = bits - 1; i >= 0; i--) {
      const bit = (v >>> i) & 1;
      const byteIndex = this.bitPos >> 3;
      const bitIndex = 7 - (this.bitPos & 7);
      this.buf[byteIndex] = (this.buf[byteIndex]! | (bit << bitIndex)) & 0xff;
      this.bitPos++;
    }
  }
  writeU8(v: number): void { this.writeBits(v & 0xff, 8); }
  writeU16(v: number): void { this.writeBits(v & 0xffff, 16); }
  writeU32(v: number): void { this.writeBits(v >>> 0, 32); }
  writeI16(v: number): void { this.writeBits((v & 0xffff), 16); }
  writeI32(v: number): void { this.writeBits(v >>> 0, 32); }
  writeBool(v: boolean): void { this.writeBits(v ? 1 : 0, 1); }
  writeString(s: string): void {
    const bytes = new TextEncoder().encode(s.slice(0, 255));
    this.writeU8(bytes.length);
    for (const b of bytes) this.writeU8(b);
  }
  get bitsWritten(): number { return this.bitPos; }
  finish(): Uint8Array {
    const bytes = Math.ceil(this.bitPos / 8);
    return this.buf.slice(0, bytes);
  }
}

export class BitReader {
  private buf: Uint8Array;
  private bitPos = 0;
  private view: DataView;
  constructor(buf: Uint8Array) { this.buf = buf; this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  readBits(bits: number): number {
    if (bits <= 0) return 0;
    if (this.bitPos + bits > this.buf.length * 8) throw new Error('[protocol] đọc quá cuối gói');
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byteIndex = this.bitPos >> 3;
      const bitIndex = 7 - (this.bitPos & 7);
      const bit = (this.buf[byteIndex]! >>> bitIndex) & 1;
      v = (v << 1) | bit;
      this.bitPos++;
    }
    return v >>> 0;
  }
  readU8(): number { return this.readBits(8); }
  readU16(): number { return this.readBits(16); }
  readU32(): number { return this.readBits(32); }
  readI16(): number {
    const v = this.readBits(16);
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  readI32(): number { return this.readBits(32) | 0; }
  readBool(): boolean { return this.readBits(1) === 1; }
  readString(): string {
    const len = this.readU8();
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = this.readU8();
    return new TextDecoder().decode(bytes);
  }
  get bitsRead(): number { return this.bitPos; }
  get remainingBits(): number { return this.buf.length * 8 - this.bitPos; }
  get raw(): Uint8Array { return this.buf; }
  get viewRef(): DataView { return this.view; }
}

// ---- Lượng tử hoá ----
export const POS_SCALE = 64;        // 1/64 m
export const VEL_SCALE = 1024;      // 1/1024 m/s
const HALF_PI = Math.PI / 2;
export function qPos(v: number): number { return Math.max(-32768, Math.min(32767, Math.round(v * POS_SCALE))); }
export function dqPos(v: number): number { return v / POS_SCALE; }
export function qVel(v: number): number { return Math.max(-32768, Math.min(32767, Math.round(v * VEL_SCALE))); }
export function dqVel(v: number): number { return v / VEL_SCALE; }
export function qYaw(y: number): number {
  let a = y % (Math.PI * 2); if (a < 0) a += Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  return Math.round(((a + Math.PI) / (Math.PI * 2)) * 65535) & 0xffff;
}
export function dqYaw(v: number): number { return (v / 65535) * Math.PI * 2 - Math.PI; }
export function qPitch(p: number): number { return Math.max(-32767, Math.min(32767, Math.round((p / HALF_PI) * 32767))); }
export function dqPitch(v: number): number { return (v / 32767) * HALF_PI; }
export function qDir(v: number): number { return Math.max(-32767, Math.min(32767, Math.round(v * 32767))); }
export function dqDir(v: number): number { return v / 32767; }
export function quantTick(t: number): number { return Math.max(0, Math.min(65535, t & 0xffff)); }

export const MATERIALS = ['sandstone', 'sand', 'concrete', 'wood', 'metal', 'glass'] as const;

export interface NetSelf {
  id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  yaw: number; pitch: number; grounded: boolean; crouching: boolean; walking: boolean;
  health: number; armor: number; alive: boolean; money: number;
  weaponIdx: number; ammo: number; reserve: number; reloading: boolean; drawing: boolean;
  recoilShots: number; scoped: boolean; blindUntilTick: number; flashIntensity: number;
  hasBomb: boolean; plantProgress: number; defuseProgress: number; planting: boolean; defusing: boolean;
  primaryIdx: number; secondaryIdx: number; grenades: number[]; helmet: boolean; hasKit: boolean;
  activeSlot: number; activeGrenade: number; respawnAtTick: number;
  kills: number; deaths: number; assists: number; damageDealt: number;
}
export interface NetPlayer {
  id: number; x: number; y: number; z: number; yaw: number; pitch: number;
  health: number; armor: number; alive: boolean; crouching: boolean; walking: boolean; grounded: boolean;
  team: Team; bot: boolean; botReplacing: boolean; weaponIdx: number; hasBomb: boolean; scoped: boolean;
}
export interface NetGrenade { id: number; kind: GrenadeKind; x: number; y: number; z: number }
export interface NetSmoke { id: number; x: number; y: number; z: number; radius: number; endTick: number }
export interface NetFire { id: number; x: number; z: number; radius: number; endTick: number }
export interface NetDrop { id: number; weaponIdx: number; x: number; y: number; z: number; ammo: number }
export interface NetRound {
  phase: RoundPhase; roundNumber: number; scoreT: number; scoreCT: number; phaseEndTick: number;
  bombPlanted: boolean; bombSite: number; bombX: number; bombY: number; bombZ: number;
  bombTimerEndTick: number; winner: number; winReason: number; overtime: boolean; lossStreakT: number; lossStreakCT: number;
}
export interface NetSnapshot {
  protocol: number;
  tick: number;
  serverTimeMs: number;
  ackSeq: number;
  baseTick: number;
  self: NetSelf;
  players: NetPlayer[];
  removedIds: number[];
  grenades: NetGrenade[];
  smokes: NetSmoke[];
  fires: NetFire[];
  drops: NetDrop[];
  round: NetRound;
  events: GameEvent[];
}

export class ProtocolCatalog {
  readonly weaponIds: string[];
  readonly weaponIndex = new Map<string, number>();
  readonly grenadeIds: GrenadeKind[] = ['he', 'flash', 'smoke', 'molotov', 'incendiary'];
  readonly weaponCategoryIdx = new Map<string, number>();
  constructor(data: GameData) {
    this.weaponIds = data.weaponsList.map((w) => w.id);
    this.weaponIds.forEach((id, i) => this.weaponIndex.set(id, i));
    data.weaponsList.forEach((w, i) => this.weaponCategoryIdx.set(w.id, i));
  }
  weaponIdx(id: string): number { return this.weaponIndex.get(id) ?? 255; }
  weaponId(idx: number): string { return this.weaponIds[idx] ?? 'knife'; }
}

const _unused_SLOT_CODES: Record<string, number> = { primary: 0, secondary: 1, knife: 2, grenade: 3, bomb: 4 };
const _unused_SLOT_NAMES = ['primary', 'secondary', 'knife', 'grenade', 'bomb'];
const PHASE_CODES: Record<RoundPhase, number> = { warmup: 0, freeze: 1, live: 2, over: 3, halftime: 4, matchEnd: 5 };
const PHASE_NAMES: RoundPhase[] = ['warmup', 'freeze', 'live', 'over', 'halftime', 'matchEnd'];
const REASON_CODES: Record<string, number> = { elimination: 0, time: 1, bomb: 2, defuse: 3 };
const REASON_NAMES = ['elimination', 'time', 'bomb', 'defuse'];
const GRENADE_INDEX: Record<string, number> = { he: 0, flash: 1, smoke: 2, molotov: 3, incendiary: 4 };
const GRENADE_NAMES: GrenadeKind[] = ['he', 'flash', 'smoke', 'molotov', 'incendiary'];
const GROUP_CODES: Record<string, number> = { head: 0, chest: 1, stomach: 2, legs: 3 };
const GROUP_NAMES = ['head', 'chest', 'stomach', 'legs'] as const;

function writePos(w: BitWriter, x: number, y: number, z: number): void {
  w.writeI16(qPos(x)); w.writeI16(qPos(y)); w.writeI16(qPos(z));
}
function readPos(r: BitReader): [number, number, number] {
  return [dqPos(r.readI16()), dqPos(r.readI16()), dqPos(r.readI16())];
}
function _unused_writePos8(w: BitWriter, x: number, y: number, z: number): void {
  w.writeU8(qPos(x) & 0xff); w.writeU8(qPos(y) & 0xff); w.writeU8(qPos(z) & 0xff);
}

function writeRound(w: BitWriter, r: NetRound): void {
  w.writeU8(PHASE_CODES[r.phase] ?? 0);
  w.writeU8(r.roundNumber & 0xff);
  w.writeU8(r.scoreT & 0xff); w.writeU8(r.scoreCT & 0xff);
  w.writeU32(r.phaseEndTick);
  w.writeBool(r.bombPlanted);
  w.writeU8(r.bombSite & 0xff);
  writePos(w, r.bombX, r.bombY, r.bombZ);
  w.writeU32(r.bombTimerEndTick);
  w.writeU8(r.winner & 0xff);
  w.writeU8(r.winReason & 0xff);
  w.writeBool(r.overtime);
  w.writeU8(r.lossStreakT); w.writeU8(r.lossStreakCT);
}
function readRound(r: BitReader): NetRound {
  const phase = PHASE_NAMES[r.readU8()] ?? 'warmup';
  const roundNumber = r.readU8();
  const scoreT = r.readU8(); const scoreCT = r.readU8();
  const phaseEndTick = r.readU32();
  const bombPlanted = r.readBool();
  const bombSite = r.readU8();
  const [bombX, bombY, bombZ] = readPos(r);
  const bombTimerEndTick = r.readU32();
  const winner = r.readU8();
  const winReason = r.readU8();
  const overtime = r.readBool();
  const lossStreakT = r.readU8(); const lossStreakCT = r.readU8();
  return {
    phase, roundNumber, scoreT, scoreCT, phaseEndTick, bombPlanted,
    bombSite: bombSite > 1 ? 0 : bombSite, bombX, bombY, bombZ, bombTimerEndTick,
    winner: winner > 2 ? 0 : winner, winReason: winReason > 3 ? 0 : winReason,
    overtime, lossStreakT, lossStreakCT,
  };
}

function writeSelf(w: BitWriter, s: NetSelf): void {
  w.writeU8(s.id);
  writePos(w, s.x, s.y, s.z);
  w.writeI16(qVel(s.vx)); w.writeI16(qVel(s.vy)); w.writeI16(qVel(s.vz));
  w.writeU16(qYaw(s.yaw)); w.writeI16(qPitch(s.pitch));
  w.writeBits((s.grounded ? 1 : 0) | (s.crouching ? 2 : 0) | (s.walking ? 4 : 0) | (s.alive ? 8 : 0) | (s.scoped ? 16 : 0) | (s.hasBomb ? 32 : 0) | (s.helmet ? 64 : 0) | (s.hasKit ? 128 : 0), 8);
  w.writeU8(Math.max(0, Math.min(255, Math.round(s.health))));
  w.writeU8(Math.max(0, Math.min(255, Math.round(s.armor))));
  w.writeU16(s.money);
  w.writeU8(s.weaponIdx === 255 ? 255 : s.weaponIdx);
  w.writeU8(Math.min(255, s.ammo)); w.writeU16(Math.min(65535, s.reserve));
  w.writeBits((s.reloading ? 1 : 0) | (s.drawing ? 2 : 0) | ((s.activeSlot & 7) << 2) | ((s.activeGrenade & 7) << 5), 8);
  w.writeU8(Math.min(255, s.recoilShots));
  w.writeU16(Math.min(65535, s.blindUntilTick & 0xffff));
  w.writeU8(Math.max(0, Math.min(255, Math.round(s.flashIntensity * 255))));
  w.writeU8(Math.max(0, Math.min(255, Math.round(s.plantProgress * 255))));
  w.writeU8(Math.max(0, Math.min(255, Math.round(s.defuseProgress * 255))));
  w.writeU8(s.primaryIdx === 255 ? 255 : s.primaryIdx);
  w.writeU8(s.secondaryIdx === 255 ? 255 : s.secondaryIdx);
  for (let i = 0; i < 5; i++) w.writeU8(Math.min(9, s.grenades[i] ?? 0));
  w.writeU16(Math.min(65535, s.respawnAtTick & 0xffff));
  w.writeU8(Math.min(255, s.kills)); w.writeU8(Math.min(255, s.deaths)); w.writeU8(Math.min(255, s.assists));
  w.writeU16(Math.min(65535, Math.round(s.damageDealt)));
}
function readSelf(r: BitReader): NetSelf {
  const id = r.readU8();
  const [x, y, z] = readPos(r);
  const vx = dqVel(r.readI16()), vy = dqVel(r.readI16()), vz = dqVel(r.readI16());
  const yaw = dqYaw(r.readU16()), pitch = dqPitch(r.readI16());
  const flags = r.readU8();
  const health = r.readU8(), armor = r.readU8(), money = r.readU16();
  const weaponIdx = r.readU8();
  const ammo = r.readU8(), reserve = r.readU16();
  const slotFlags = r.readU8();
  const activeSlot = (slotFlags >> 2) & 7;
  const activeGrenade = (slotFlags >> 5) & 7;
  const recoilShots = r.readU8();
  const blindUntilTick = r.readU16();
  const flashIntensity = r.readU8() / 255;
  const plantProgress = r.readU8() / 255;
  const defuseProgress = r.readU8() / 255;
  const primaryIdx = r.readU8();
  const secondaryIdx = r.readU8();
  const grenades: number[] = [];
  for (let i = 0; i < 5; i++) grenades.push(r.readU8());
  const respawnAtTick = r.readU16();
  const kills = r.readU8(), deaths = r.readU8(), assists = r.readU8();
  const damageDealt = r.readU16();
  return {
    id, x, y, z, vx, vy, vz, yaw, pitch,
    grounded: !!(flags & 1), crouching: !!(flags & 2), walking: !!(flags & 4), alive: !!(flags & 8),
    scoped: !!(flags & 16), hasBomb: !!(flags & 32), helmet: !!(flags & 64), hasKit: !!(flags & 128),
    health, armor, money, weaponIdx, ammo, reserve,
    reloading: !!(slotFlags & 1), drawing: !!(slotFlags & 2),
    activeSlot, activeGrenade: Math.min(4, activeGrenade),
    recoilShots, blindUntilTick, flashIntensity, plantProgress, defuseProgress,
    planting: plantProgress > 0, defusing: defuseProgress > 0,
    primaryIdx, secondaryIdx, grenades, respawnAtTick, kills, deaths, assists, damageDealt,
  };
}

const P_POS = 1, P_ANGLE = 2, P_HEALTH = 4, P_FLAGS = 8, P_WEAPON = 16;

function writePlayerDelta(w: BitWriter, cur: NetPlayer, base: NetPlayer | null): void {
  w.writeU8(cur.id);
  let mask = 0;
  const angleChanged = !base || qYaw(cur.yaw) !== qYaw(base.yaw) || qPitch(cur.pitch) !== qPitch(base.pitch);
  const posChanged = !base || qPos(cur.x) !== qPos(base.x) || qPos(cur.y) !== qPos(base.y) || qPos(cur.z) !== qPos(base.z);
  const hpChanged = !base || cur.health !== base.health || cur.armor !== base.armor;
  const flagsChanged = !base || cur.alive !== base.alive || cur.crouching !== base.crouching || cur.walking !== base.walking
    || cur.grounded !== base.grounded || cur.team !== base.team || cur.bot !== base.bot
    || cur.botReplacing !== base.botReplacing || cur.hasBomb !== base.hasBomb || cur.scoped !== base.scoped;
  const weaponChanged = !base || cur.weaponIdx !== base.weaponIdx;
  if (posChanged) mask |= P_POS;
  if (angleChanged) mask |= P_ANGLE;
  if (hpChanged) mask |= P_HEALTH;
  if (flagsChanged) mask |= P_FLAGS;
  if (weaponChanged) mask |= P_WEAPON;
  w.writeU8(mask);
  if (mask & P_POS) { writePos(w, cur.x, cur.y, cur.z); }
  if (mask & P_ANGLE) { w.writeU16(qYaw(cur.yaw)); w.writeI16(qPitch(cur.pitch)); }
  if (mask & P_HEALTH) { w.writeU8(cur.health); w.writeU8(cur.armor); }
  if (mask & P_FLAGS) {
    w.writeBits((cur.alive ? 1 : 0) | (cur.crouching ? 2 : 0) | (cur.walking ? 4 : 0) | (cur.grounded ? 8 : 0)
      | (cur.team === 'T' ? 0 : 16) | (cur.bot ? 32 : 0) | (cur.botReplacing ? 64 : 0), 7);
    w.writeBool(cur.scoped);
    w.writeBool(cur.hasBomb);
  }
  if (mask & P_WEAPON) w.writeU8(cur.weaponIdx);
}
function readPlayerDelta(r: BitReader, basePlayers: Map<number, NetPlayer>): NetPlayer | null {
  const id = r.readU8();
  const base = basePlayers.get(id);
  const mask = r.readU8();
  if (!base && mask === 0) return null;
  const p: NetPlayer = base ? { ...base } : {
    id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, armor: 0, alive: true,
    crouching: false, walking: false, grounded: true, team: 'T', bot: false, botReplacing: false,
    weaponIdx: 255, hasBomb: false, scoped: false,
  };
  if (mask & P_POS) { const [x, y, z] = readPos(r); p.x = x; p.y = y; p.z = z; }
  if (mask & P_ANGLE) { p.yaw = dqYaw(r.readU16()); p.pitch = dqPitch(r.readI16()); }
  if (mask & P_HEALTH) { p.health = r.readU8(); p.armor = r.readU8(); }
  if (mask & P_FLAGS) {
    const f = r.readBits(7);
    p.alive = !!(f & 1); p.crouching = !!(f & 2); p.walking = !!(f & 4); p.grounded = !!(f & 8);
    p.team = (f & 16) ? 'CT' : 'T'; p.bot = !!(f & 32); p.botReplacing = !!(f & 64);
    p.scoped = r.readBool();
    p.hasBomb = r.readBool();
  }
  if (mask & P_WEAPON) p.weaponIdx = r.readU8();
  return { ...p, id };
}

function writeEvents(w: BitWriter, events: GameEvent[], cat: ProtocolCatalog): void {
  const list = events.slice(0, 96);
  w.writeU8(list.length);
  for (const e of list) {
    switch (e.type) {
      case 'shot':
        w.writeU8(1); w.writeU8(e.playerId); w.writeU8(cat.weaponIdx(e.weapon));
        writePos(w, e.x, e.y, e.z);
        w.writeI16(qDir(e.dx)); w.writeI16(qDir(e.dy)); w.writeI16(qDir(e.dz));
        break;
      case 'hit':
        w.writeU8(2); w.writeU8(e.attacker & 0xff); w.writeU8(e.victim & 0xff);
        w.writeU16(Math.min(65535, Math.round(e.damage * 10)));
        w.writeU8(GROUP_CODES[e.group] ?? 1);
        writePos(w, e.x, e.y, e.z);
        w.writeBool(e.lethal);
        break;
      case 'impact':
        w.writeU8(3); writePos(w, e.x, e.y, e.z);
        w.writeU8(Math.max(0, MATERIALS.indexOf(e.material as (typeof MATERIALS)[number])));
        break;
      case 'kill':
        w.writeU8(4); w.writeU8(e.attacker === null ? 255 : e.attacker); w.writeU8(e.victim);
        w.writeU8(cat.weaponIdx(e.weapon)); w.writeBool(e.headshot); writePos(w, e.x, e.y, e.z);
        break;
      case 'reload_start':
        w.writeU8(5); w.writeU8(e.playerId); w.writeU8(cat.weaponIdx(e.weapon)); w.writeU16(Math.min(65535, Math.round(e.durationSec * 1000)));
        break;
      case 'reload_end':
        w.writeU8(6); w.writeU8(e.playerId); w.writeU8(cat.weaponIdx(e.weapon));
        break;
      case 'weapon_switch':
        w.writeU8(7); w.writeU8(e.playerId); w.writeU8(cat.weaponIdx(e.weapon));
        break;
      case 'bomb_planted':
        w.writeU8(8); w.writeU8(e.site === 'A' ? 0 : 1); writePos(w, e.x, e.y, e.z);
        break;
      case 'bomb_defused':
        w.writeU8(9); w.writeU8(e.playerId);
        break;
      case 'bomb_exploded':
        w.writeU8(10); writePos(w, e.x, e.y, e.z);
        break;
      case 'bomb_beep':
        w.writeU8(11); writePos(w, e.x, e.y, e.z); w.writeU8(Math.round(e.rate * 255));
        break;
      case 'grenade_explode':
        w.writeU8(12); w.writeU8(GRENADE_INDEX[e.kind] ?? 0); writePos(w, e.x, e.y, e.z);
        break;
      case 'smoke_start':
        w.writeU8(13); writePos(w, e.x, e.y, e.z); w.writeU16(Math.round(e.radius * 100));
        break;
      case 'smoke_end':
        w.writeU8(14); writePos(w, e.x, e.y, e.z);
        break;
      case 'flash':
        w.writeU8(15); writePos(w, e.x, e.y, e.z); w.writeU8(e.playerId);
        break;
      case 'fire_start':
        w.writeU8(16); writePos(w, e.x, e.y, e.z); w.writeU16(Math.round(e.radius * 100));
        break;
      case 'footstep':
        w.writeU8(17); w.writeU8(e.playerId); writePos(w, e.x, e.y, e.z); w.writeU8(Math.max(0, MATERIALS.indexOf(e.material as (typeof MATERIALS)[number])));
        break;
      case 'round_start':
        w.writeU8(18); w.writeU8(e.round & 0xff);
        break;
      case 'round_end':
        w.writeU8(19); w.writeU8(e.winner === 'T' ? 0 : 1); w.writeU8(REASON_CODES[e.reason] ?? 0);
        w.writeU8(e.scoreT); w.writeU8(e.scoreCT);
        break;
      case 'match_end':
        w.writeU8(20); w.writeU8(e.winner === 'T' ? 0 : 1);
        break;
      case 'damage':
        w.writeU8(21); w.writeU8(e.victim); w.writeU16(Math.min(65535, Math.round(e.amount * 10))); w.writeU8(e.attacker === null ? 255 : e.attacker);
        break;
      case 'chat':
        w.writeU8(22); w.writeU8(e.playerId); w.writeString(e.text);
        break;
      case 'radio':
        w.writeU8(23); w.writeU8(e.playerId); w.writeString(e.text);
        break;
      case 'spawn':
        w.writeU8(24); w.writeU8(e.playerId);
        break;
      case 'buy':
        w.writeU8(25); w.writeU8(e.playerId); w.writeString(e.itemId);
        break;
      case 'scope':
        w.writeU8(26); w.writeU8(e.playerId); w.writeBool(e.scoped);
        break;
      case 'dryfire':
        w.writeU8(27); w.writeU8(e.playerId);
        break;
      case 'plant_start':
        w.writeU8(28); w.writeU8(e.playerId);
        break;
      case 'defuse_start':
        w.writeU8(29); w.writeU8(e.playerId);
        break;
      case 'pickup':
        w.writeU8(30); w.writeU8(e.playerId); w.writeString(e.itemId);
        break;
      case 'bomb_dropped':
        w.writeU8(31); writePos(w, e.x, e.y, e.z);
        break;
      case 'round_freeze_end':
        w.writeU8(32);
        break;
      case 'grenade_throw':
        w.writeU8(33); w.writeU8(e.playerId); w.writeU8(GRENADE_INDEX[e.kind] ?? 0); w.writeBool(e.weak);
        break;
    }
  }
}

function readEvents(r: BitReader, cat: ProtocolCatalog, tick: number): GameEvent[] {
  const out: GameEvent[] = [];
  const count = r.readU8();
  for (let i = 0; i < count; i++) {
    const t = r.readU8();
    switch (t) {
      case 1: {
        const playerId = r.readU8(); const weapon = cat.weaponId(r.readU8());
        const [x, y, z] = readPos(r);
        const dx = dqDir(r.readI16()), dy = dqDir(r.readI16()), dz = dqDir(r.readI16());
        out.push({ type: 'shot', tick, playerId, weapon, x, y, z, dx, dy, dz });
        break;
      }
      case 2: {
        const attacker = r.readU8(); const victim = r.readU8(); const damage = r.readU16() / 10;
        const group = GROUP_NAMES[r.readU8()] ?? 'chest';
        const [x, y, z] = readPos(r); const lethal = r.readBool();
        out.push({ type: 'hit', tick, attacker: attacker === 255 ? -1 : attacker, victim, damage, group, x, y, z, nx: 0, ny: 0, nz: 0, lethal });
        break;
      }
      case 3: {
        const [x, y, z] = readPos(r); const material = MATERIALS[r.readU8()] ?? 'concrete';
        out.push({ type: 'impact', tick, x, y, z, nx: 0, ny: 0, nz: 0, material });
        break;
      }
      case 4: {
        const a = r.readU8(); const victim = r.readU8(); const weapon = cat.weaponId(r.readU8());
        const headshot = r.readBool(); const [x, y, z] = readPos(r);
        out.push({ type: 'kill', tick, attacker: a === 255 ? null : a, victim, weapon, headshot, x, y, z });
        break;
      }
      case 5: {
        const playerId = r.readU8(); const weapon = cat.weaponId(r.readU8()); const durationSec = r.readU16() / 1000;
        out.push({ type: 'reload_start', tick, playerId, weapon, durationSec });
        break;
      }
      case 6: out.push({ type: 'reload_end', tick, playerId: r.readU8(), weapon: cat.weaponId(r.readU8()) }); break;
      case 7: out.push({ type: 'weapon_switch', tick, playerId: r.readU8(), weapon: cat.weaponId(r.readU8()) }); break;
      case 8: { const site = r.readU8() === 0 ? 'A' : 'B'; const [x, y, z] = readPos(r); out.push({ type: 'bomb_planted', tick, site, x, y, z }); break; }
      case 9: out.push({ type: 'bomb_defused', tick, playerId: r.readU8() }); break;
      case 10: { const [x, y, z] = readPos(r); out.push({ type: 'bomb_exploded', tick, x, y, z }); break; }
      case 11: { const [x, y, z] = readPos(r); const rate = r.readU8() / 255; out.push({ type: 'bomb_beep', tick, x, y, z, rate }); break; }
      case 12: { const kind = GRENADE_NAMES[r.readU8()] ?? 'he'; const [x, y, z] = readPos(r); out.push({ type: 'grenade_explode', tick, kind, x, y, z }); break; }
      case 13: { const [x, y, z] = readPos(r); const radius = r.readU16() / 100; out.push({ type: 'smoke_start', tick, x, y, z, radius }); break; }
      case 14: { const [x, y, z] = readPos(r); out.push({ type: 'smoke_end', tick, x, y, z }); break; }
      case 15: { const [x, y, z] = readPos(r); const playerId = r.readU8(); out.push({ type: 'flash', tick, x, y, z, playerId }); break; }
      case 16: { const [x, y, z] = readPos(r); const radius = r.readU16() / 100; out.push({ type: 'fire_start', tick, x, y, z, radius }); break; }
      case 17: { const playerId = r.readU8(); const [x, y, z] = readPos(r); const material = MATERIALS[r.readU8()] ?? 'concrete'; out.push({ type: 'footstep', tick, playerId, x, y, z, material }); break; }
      case 18: out.push({ type: 'round_start', tick, round: r.readU8() }); break;
      case 19: { const winner = (r.readU8() === 0 ? 'T' : 'CT') as Team; const reason = REASON_NAMES[r.readU8()] ?? 'elimination'; const scoreT = r.readU8(); const scoreCT = r.readU8(); out.push({ type: 'round_end', tick, winner, reason, scoreT, scoreCT }); break; }
      case 20: out.push({ type: 'match_end', tick, winner: (r.readU8() === 0 ? 'T' : 'CT') as Team }); break;
      case 21: { const victim = r.readU8(); const amount = r.readU16() / 10; const a = r.readU8(); out.push({ type: 'damage', tick, victim, amount, attacker: a === 255 ? null : a }); break; }
      case 22: { const playerId = r.readU8(); const text = r.readString(); out.push({ type: 'chat', tick, playerId, text }); break; }
      case 23: { const playerId = r.readU8(); const text = r.readString(); out.push({ type: 'radio', tick, playerId, text }); break; }
      case 24: out.push({ type: 'spawn', tick, playerId: r.readU8() }); break;
      case 25: { const playerId = r.readU8(); const itemId = r.readString(); out.push({ type: 'buy', tick, playerId, itemId }); break; }
      case 26: { const playerId = r.readU8(); const scoped = r.readBool(); out.push({ type: 'scope', tick, playerId, scoped }); break; }
      case 27: out.push({ type: 'dryfire', tick, playerId: r.readU8() }); break;
      case 28: out.push({ type: 'plant_start', tick, playerId: r.readU8() }); break;
      case 29: out.push({ type: 'defuse_start', tick, playerId: r.readU8() }); break;
      case 30: { const playerId = r.readU8(); const itemId = r.readString(); out.push({ type: 'pickup', tick, playerId, itemId }); break; }
      case 31: { const [x, y, z] = readPos(r); out.push({ type: 'bomb_dropped', tick, x, y, z }); break; }
      case 32: out.push({ type: 'round_freeze_end', tick }); break;
      case 33: { const playerId = r.readU8(); const kind = GRENADE_NAMES[r.readU8()] ?? 'he'; const weak = r.readBool(); out.push({ type: 'grenade_throw', tick, playerId, kind, weak }); break; }
      default: return out;
    }
  }
  return out;
}

export function encodeSnapshot(snap: NetSnapshot, base: NetSnapshot | null, cat: ProtocolCatalog): Uint8Array {
  const w = new BitWriter(1024);
  w.writeU8(PROTOCOL_VERSION);
  w.writeU32(snap.tick);
  w.writeU32(snap.serverTimeMs >>> 0);
  w.writeU32(snap.ackSeq);
  w.writeBool(base !== null);
  w.writeU32(base ? base.tick : 0);
  writeSelf(w, snap.self);
  writeRound(w, snap.round);

  const basePlayers = new Map<number, NetPlayer>();
  if (base) for (const p of base.players) basePlayers.set(p.id, p);
  const currentIds = new Set(snap.players.map((p) => p.id));
  const removed = base ? base.players.filter((p) => !currentIds.has(p.id)).map((p) => p.id) : [];
  w.writeU8(Math.min(255, removed.length));
  for (const id of removed.slice(0, 255)) w.writeU8(id);
  w.writeU8(Math.min(255, snap.players.length));
  for (const p of snap.players.slice(0, 255)) writePlayerDelta(w, p, basePlayers.get(p.id) ?? null);

  w.writeU8(Math.min(255, snap.grenades.length));
  for (const g of snap.grenades.slice(0, 255)) {
    w.writeU8(g.id & 0xff); w.writeU8(GRENADE_INDEX[g.kind] ?? 0); writePos(w, g.x, g.y, g.z);
  }
  w.writeU8(Math.min(255, snap.smokes.length));
  for (const s of snap.smokes.slice(0, 255)) {
    w.writeU8(s.id & 0xff); writePos(w, s.x, s.y, s.z); w.writeU16(Math.round(s.radius * 100)); w.writeU16(s.endTick & 0xffff);
  }
  w.writeU8(Math.min(255, snap.fires.length));
  for (const f of snap.fires.slice(0, 255)) {
    w.writeU8(f.id & 0xff); w.writeI16(qPos(f.x)); w.writeI16(qPos(f.z)); w.writeU16(Math.round(f.radius * 100)); w.writeU16(f.endTick & 0xffff);
  }
  w.writeU8(Math.min(255, snap.drops.length));
  for (const d of snap.drops.slice(0, 255)) {
    w.writeU8(d.id & 0xff); w.writeU8(d.weaponIdx); writePos(w, d.x, d.y, d.z); w.writeU8(Math.min(255, d.ammo));
  }
  writeEvents(w, snap.events, cat);
  return w.finish();
}

export function decodeSnapshot(data: Uint8Array, base: NetSnapshot | null, cat: ProtocolCatalog): NetSnapshot {
  const r = new BitReader(data);
  const protocol = r.readU8();
  if (protocol !== PROTOCOL_VERSION) throw new Error(`[protocol] sai phiên bản ${protocol}`);
  const tick = r.readU32();
  const serverTimeMs = r.readU32();
  const ackSeq = r.readU32();
  const hasBase = r.readBool();
  const baseTick = r.readU32();
  const self = readSelf(r);
  const round = readRound(r);

  const basePlayers = new Map<number, NetPlayer>();
  if (hasBase && base) for (const p of base.players) basePlayers.set(p.id, p);
  const removedIds: number[] = [];
  const removedCount = r.readU8();
  for (let i = 0; i < removedCount; i++) removedIds.push(r.readU8());
  const count = r.readU8();
  const merged = new Map<number, NetPlayer>();
  if (base) {
    for (const p of base.players) {
      if (!removedIds.includes(p.id)) merged.set(p.id, p);
    }
  }
  for (let i = 0; i < count; i++) {
    const p = readPlayerDelta(r, basePlayers);
    if (p) merged.set(p.id, p);
  }
  const players = Array.from(merged.values());
  const grenades: NetGrenade[] = [];
  const gc = r.readU8();
  for (let i = 0; i < gc; i++) {
    const id = r.readU8(); const kind = GRENADE_NAMES[r.readU8()] ?? 'he';
    const [x, y, z] = readPos(r);
    grenades.push({ id, kind, x, y, z });
  }
  const smokes: NetSmoke[] = [];
  const sc = r.readU8();
  for (let i = 0; i < sc; i++) {
    const id = r.readU8(); const [x, y, z] = readPos(r);
    const radius = r.readU16() / 100; const endTick = r.readU16();
    smokes.push({ id, x, y, z, radius, endTick });
  }
  const fires: NetFire[] = [];
  const fc = r.readU8();
  for (let i = 0; i < fc; i++) {
    const id = r.readU8();
    const x = dqPos(r.readI16()); const z = dqPos(r.readI16());
    const radius = r.readU16() / 100; const endTick = r.readU16();
    fires.push({ id, x, z, radius, endTick });
  }
  const drops: NetDrop[] = [];
  const dc = r.readU8();
  for (let i = 0; i < dc; i++) {
    const id = r.readU8(); const weaponIdx = r.readU8(); const [x, y, z] = readPos(r); const ammo = r.readU8();
    drops.push({ id, weaponIdx, x, y, z, ammo });
  }
  const events = readEvents(r, cat, tick);
  void baseTick;
  return { protocol, tick, serverTimeMs, ackSeq, baseTick, self, players, removedIds, grenades, smokes, fires, drops, round, events };
}

// ---- Input ----
export interface NetInput {
  seq: number;
  tick: number;
  forward: number;
  right: number;
  yaw: number;
  pitch: number;
  buttons: number;
  grenadeSlot: number;
  viewTick: number;
}
export function encodeInputPacket(inputs: NetInput[], ackSnapshotTick: number, ackInputSeq: number): Uint8Array {
  const w = new BitWriter(256);
  w.writeU8(PROTOCOL_VERSION);
  w.writeU8(Math.min(255, inputs.length));
  w.writeU32(ackSnapshotTick);
  w.writeU32(ackInputSeq);
  for (const c of inputs.slice(0, 255)) {
    w.writeU32(c.seq);
    w.writeU32(c.tick & 0xffffffff);
    w.writeU16(c.buttons);
    w.writeI16(Math.round(c.forward * 32767));
    w.writeI16(Math.round(c.right * 32767));
    w.writeU16(qYaw(c.yaw));
    w.writeI16(qPitch(c.pitch));
    w.writeU8(c.grenadeSlot & 7);
    w.writeI32(Math.max(0, c.viewTick | 0));
  }
  return w.finish();
}
export function decodeInputPacket(data: Uint8Array): { inputs: NetInput[]; ackSnapshotTick: number; ackInputSeq: number } {
  const r = new BitReader(data);
  const ver = r.readU8();
  if (ver !== PROTOCOL_VERSION) throw new Error('[protocol] input sai phiên bản');
  const count = r.readU8();
  const ackSnapshotTick = r.readU32();
  const ackInputSeq = r.readU32();
  const inputs: NetInput[] = [];
  for (let i = 0; i < count; i++) {
    const seq = r.readU32(); const tick = r.readU32(); const buttons = r.readU16();
    const forward = r.readI16() / 32767, right = r.readI16() / 32767;
    const yaw = dqYaw(r.readU16()); const pitch = dqPitch(r.readI16());
    const grenadeSlot = r.readU8() & 7;
    const viewTick = r.readI32();
    inputs.push({ seq, tick, forward, right, yaw, pitch, buttons, grenadeSlot, viewTick });
  }
  return { inputs, ackSnapshotTick, ackInputSeq };
}
