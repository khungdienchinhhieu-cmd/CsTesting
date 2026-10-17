

export type Team = 'T' | 'CT';
export type PlayerId = number;
export type Slot = 'primary' | 'secondary' | 'knife' | 'grenade' | 'bomb';
export type WeaponCategory = 'knife' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper';
export type GrenadeKind = 'he' | 'flash' | 'smoke' | 'molotov' | 'incendiary';
export type HitboxGroup = 'head' | 'chest' | 'stomach' | 'legs';

export enum Buttons {
  Fire = 1,
  Jump = 2,
  Crouch = 4,
  Walk = 8,
  Use = 16,
  Reload = 32,
  SlotPrimary = 64,
  SlotSecondary = 128,
  SlotKnife = 256,
  SlotGrenade = 512,
  Drop = 1024,
  Inspect = 2048,
  Scope = 4096,
  Radio = 8192,
}

export interface InputCommand {
  seq: number;
  tick: number;
  dt: number;
  forward: number;
  right: number;
  yaw: number;
  pitch: number;
  buttons: number;
  /** Vị trí lựu đạn đang chọn (0..3) khi bấm SlotGrenade. */
  grenadeSlot: number;
  /** Tick server mà client ước lượng khi ngắm (lag compensation). */
  viewTick?: number;
}

export interface AmmoState { mag: number; reserve: number }

export interface PlayerLoadout {
  primary: string | null;
  secondary: string | null;
  grenades: Record<GrenadeKind, number>;
  armor: number;
  helmet: boolean;
  defuseKit: boolean;
}

export interface EyePose { x: number; y: number; z: number; yaw: number; pitch: number }

export interface PlayerState {
  id: PlayerId;
  name: string;
  team: Team;
  isBot: boolean;
  botReplacing: boolean;
  connected: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  eyeY: number;
  crouching: boolean;
  walking: boolean;
  grounded: boolean;
  health: number;
  armor: number;
  helmet: boolean;
  alive: boolean;
  money: number;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  roundsPlayed: number;
  loadout: PlayerLoadout;
  activeSlot: Slot;
  activeWeapon: string;
  activeGrenade: GrenadeKind | null;
  ammo: Record<string, AmmoState>;
  reloadingUntilTick: number;
  reloadingWeapon: string | null;
  nextAttackTick: number;
  lastAttackTick: number;
  triggerWasDown: boolean;
  jumpWasDown: boolean;
  prevButtons: number;
  recoilShots: number;
  lastShotTick: number;
  scoped: boolean;
  hasBomb: boolean;
  plantProgress: number;
  defuseProgress: number;
  defuseKitActive: boolean;
  blindUntilTick: number;
  flashIntensity: number;
  burnUntilTick: number;
  spawnTick: number;
  respawnAtTick: number;
  dropRequested: boolean;
  inspectUntilTick: number;
  drawingUntilTick: number;
  planting: boolean;
  defusing: boolean;
  lastFootstepTick: number;
  lastDamagedBy: PlayerId | null;
  lastDamageTick: number;
  assistCreditUntilTick: number;
  spawnIndex: number;
  mvmtState: 'idle' | 'walk' | 'run' | 'crouch' | 'jump' | 'land';
  ping: number;
}

export interface HitboxState {
  head: AABB;
  chest: AABB;
  stomach: AABB;
  legs: AABB;
}

export interface AABB { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

export interface SmokeVolume {
  id: number;
  /** Tâm khói, bán kính hiệu dụng (m). */
  x: number; y: number; z: number; radius: number;
  startTick: number; endTick: number;
  active: boolean;
  /** Lưới voxel thô 40^3 (0 = trống). Chỉ server/tác động HE, đạn. */
  voxels: Uint8Array | null;
  holes: { x: number; y: number; z: number; r: number }[];
}

export interface FireVolume {
  id: number; x: number; z: number; radius: number;
  startTick: number; endTick: number;
  ownerId: PlayerId; team: Team;
}

export interface GrenadeProjectile {
  id: number;
  kind: GrenadeKind;
  ownerId: PlayerId;
  team: Team;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  spawnTick: number;
  fuseTick: number;
  detonated: boolean;
  bounces: number;
}

export type RoundPhase = 'warmup' | 'freeze' | 'live' | 'over' | 'halftime' | 'matchEnd';

export interface RoundState {
  phase: RoundPhase;
  phaseEndTick: number;
  roundNumber: number;
  scoreT: number;
  scoreCT: number;
  bombPlanted: boolean;
  bombSite: 'A' | 'B' | null;
  bombX: number; bombY: number; bombZ: number;
  bombTimerEndTick: number;
  bombBeingPlantedBy: PlayerId | null;
  bombBeingDefusedBy: PlayerId | null;
  bombDefuseEndTick: number;
  winner: Team | null;
  winReason: 'elimination' | 'time' | 'bomb' | 'defuse' | null;
  roundStartTick: number;
  lossStreakT: number;
  lossStreakCT: number;
  halftimeDone: boolean;
  overtime: boolean;
  overtimeBlock: number;
}

export interface MatchConfig {
  mode: 'competitive' | 'quick' | 'deathmatch' | 'range' | 'custom';
  mapId: string;
  warmupSec?: number;
  roundsToWin: number;
  freezeTimeSec: number;
  roundTimeSec: number;
  maxRounds: number;
  overtimeEnabled: boolean;
  botFill: boolean;
  infiniteMoney: boolean;
  friendlyFire: boolean;
}

export interface GameEventBase { tick: number }
export type GameEvent =
  | (GameEventBase & { type: 'shot'; playerId: PlayerId; weapon: string; x: number; y: number; z: number; dx: number; dy: number; dz: number })
  | (GameEventBase & { type: 'hit'; attacker: PlayerId; victim: PlayerId; damage: number; group: HitboxGroup; x: number; y: number; z: number; nx: number; ny: number; nz: number; lethal: boolean })
  | (GameEventBase & { type: 'kill'; attacker: PlayerId | null; victim: PlayerId; weapon: string; headshot: boolean; x: number; y: number; z: number })
  | (GameEventBase & { type: 'reload_start'; playerId: PlayerId; weapon: string; durationSec: number })
  | (GameEventBase & { type: 'reload_end'; playerId: PlayerId; weapon: string })
  | (GameEventBase & { type: 'weapon_switch'; playerId: PlayerId; weapon: string })
  | (GameEventBase & { type: 'bomb_planted'; site: 'A' | 'B'; x: number; y: number; z: number })
  | (GameEventBase & { type: 'bomb_defused'; playerId: PlayerId })
  | (GameEventBase & { type: 'bomb_exploded'; x: number; y: number; z: number })
  | (GameEventBase & { type: 'bomb_beep'; x: number; y: number; z: number; rate: number })
  | (GameEventBase & { type: 'grenade_explode'; kind: GrenadeKind; x: number; y: number; z: number })
  | (GameEventBase & { type: 'smoke_start'; x: number; y: number; z: number; radius: number })
  | (GameEventBase & { type: 'smoke_end'; x: number; y: number; z: number })
  | (GameEventBase & { type: 'flash'; x: number; y: number; z: number; playerId: PlayerId })
  | (GameEventBase & { type: 'fire_start'; x: number; y: number; z: number; radius: number })
  | (GameEventBase & { type: 'footstep'; playerId: PlayerId; x: number; y: number; z: number; material: string })
  | (GameEventBase & { type: 'round_start'; round: number })
  | (GameEventBase & { type: 'round_end'; winner: Team; reason: string; scoreT: number; scoreCT: number })
  | (GameEventBase & { type: 'match_end'; winner: Team })
  | (GameEventBase & { type: 'damage'; victim: PlayerId; amount: number; attacker: PlayerId | null })
  | (GameEventBase & { type: 'chat'; playerId: PlayerId; text: string })
  | (GameEventBase & { type: 'radio'; playerId: PlayerId; text: string })
  | (GameEventBase & { type: 'spawn'; playerId: PlayerId })
  | (GameEventBase & { type: 'buy'; playerId: PlayerId; itemId: string })
  | (GameEventBase & { type: 'scope'; playerId: PlayerId; scoped: boolean })
  | (GameEventBase & { type: 'dryfire'; playerId: PlayerId })
  | (GameEventBase & { type: 'plant_start'; playerId: PlayerId })
  | (GameEventBase & { type: 'defuse_start'; playerId: PlayerId })
  | (GameEventBase & { type: 'pickup'; playerId: PlayerId; itemId: string })
  | (GameEventBase & { type: 'bomb_dropped'; x: number; y: number; z: number })
  | (GameEventBase & { type: 'round_freeze_end' })
  | (GameEventBase & { type: 'grenade_throw'; playerId: PlayerId; kind: GrenadeKind; weak: boolean })
  | (GameEventBase & { type: 'impact'; x: number; y: number; z: number; nx: number; ny: number; nz: number; material: string });

export interface ShotResult {
  hitPlayer: PlayerId | null;
  group: HitboxGroup | null;
  damage: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  lethal: boolean;
}

export interface BuyItem {
  id: string;
  kind: 'weapon' | 'armor' | 'helmet' | 'kit' | 'grenade';
  ref: string;
  price: number;
  team: Team | 'both';
  displayName: string;
}
