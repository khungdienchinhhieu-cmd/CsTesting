// Ranh giới bot: bot CHỈ được nhìn thấy các kiểu này.
// Không import mô phỏng thật (MatchSim), không truy cập vị trí địch ngoài tầm nhìn.
import type { GrenadeKind, Team } from './types';
export { Buttons } from './types';
export type { GrenadeKind, Team } from './types';
export const BOT_TICK_RATE = 64;

export interface Vec3 { x: number; y: number; z: number }

export interface BotWeaponView {
  id: string;
  category: string;
  fireMode: string;
  rpm: number;
  magazine: number;
  reserve: number;
  spreadStand: number;
  spreadRun: number;
  recoil: [number, number][];
  reloadSec: number;
  reloadEmptySec: number;
  range: number;
  pellets: number;
  price: number;
}

export interface BotSelfState {
  id: number;
  team: Team;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  health: number; armor: number; helmet: boolean;
  crouching: boolean; walking: boolean; grounded: boolean;
  weaponId: string; weaponCategory: string; ammo: number; reserve: number;
  activeSlot: string; activeGrenade: GrenadeKind | null;
  grenades: Record<GrenadeKind, number>;
  hasBomb: boolean;
  hasDefuseKit: boolean;
  money: number;
  reloading: boolean;
  blinded: boolean;
  blindRemainingSec: number;
  recoilShots: number;
  scoped: boolean;
  alive: boolean;
  role?: string;
  weapon: BotWeaponView;
  primaryId: string | null;
  secondaryId: string | null;
  recentHitConfirm: boolean;
}

export interface BotEnemyView {
  id: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  health: number; armor: number; helmet: boolean;
  weaponId: string; weaponCategory: string;
  crouching: boolean; grounded: boolean;
  distance: number;
  /** Góc lệch so với tâm ngắm hiện tại (radian). */
  angleOffAim: number;
  exposure: number;
  visibleParts: ('head' | 'chest' | 'stomach' | 'legs')[];
  lastSeenAgeSec: number;
  firstSeenTick: number;
  isBot: boolean;
}

export interface BotTeammateView {
  id: number;
  x: number; y: number; z: number;
  health: number; armor: number; alive: boolean; hasBomb: boolean;
  weaponId: string; weaponCategory: string;
  distance: number;
  inMyFov: boolean;
}

export interface BotSoundEvent {
  kind: 'footstep' | 'gunshot' | 'reload' | 'bomb_beep' | 'plant' | 'defuse' | 'grenade_bounce' | 'explosion' | 'jump' | 'land' | 'scope' | 'pickup';
  /** Vị trí thô đã lượng tử hoá (sai số ±1.5m) — không lộ vị trí chính xác. */
  x: number; y: number; z: number;
  tick: number;
  loudness: number;
  confidence: number;
  fromTeammate: boolean;
  /** Chỉ có khi fromTeammate = true. */
  teammateId?: number;
}

export interface BotCommsMessage {
  fromId: number;
  kind: 'enemy_spotted' | 'enemy_heard' | 'bomb_planted' | 'bomb_dropped' | 'request_help' | 'rotating' | 'clear' | 'going_a' | 'going_b' | 'save' | 'defusing' | 'planting';
  x?: number; y?: number; z?: number;
  confidence: number;
  tickReceived: number;
  text: string;
}

export interface BotCallout { name: string; rect: [number, number, number, number] }
export interface BotSite { id: 'A' | 'B'; rect: [number, number, number, number]; center: [number, number, number] }

export interface BotNavigation {
  findPath(sx: number, sz: number, gx: number, gz: number, out: Vec3[]): number;
  canWalkStraight(ax: number, az: number, bx: number, bz: number): boolean;
  randomPointNear(x: number, z: number, radius: number): [number, number];
  isWalkable(x: number, z: number): boolean;
}

export interface BotMapView {
  id: string;
  callouts: BotCallout[];
  sites: BotSite[];
  buyZones: { T: [number, number, number, number][]; CT: [number, number, number, number][] };
  spawns: { T: [number, number, number][]; CT: [number, number, number][] };
  bounds: [number, number, number, number, number, number];
  nav: BotNavigation;
}

export interface BotRoundView {
  phase: string;
  roundNumber: number;
  scoreT: number;
  scoreCT: number;
  phaseTimeLeftSec: number;
  bombPlanted: boolean;
  bombSite: 'A' | 'B' | null;
  bombX: number; bombY: number; bombZ: number;
  bombTimeLeftSec: number;
  carriedByMe: boolean;
  bombCarriedByTeammate: boolean;
  bombDropped: boolean;
  bombDroppedX: number; bombDroppedY: number; bombDroppedZ: number;
  bombBeingDefused: boolean;
  plantProgress: number;
  defuseProgress: number;
  siteA: BotSite | undefined;
  siteB: BotSite | undefined;
}

export interface BotBuyOption { id: string; price: number; kind: string; category: string }

export interface BotMatchView {
  mode: string;
  team: Team;
  teammatesAlive: number;
  enemiesAlive: number;
  timeSinceRoundStartSec: number;
  lossStreak: number;
  enemyEconomyEstimate: 'eco' | 'force' | 'full' | 'unknown';
  ownEconomy: 'eco' | 'force' | 'full';
  buyOptions: BotBuyOption[];
}

export interface BotSensorView {
  tick: number;
  self: BotSelfState;
  enemies: BotEnemyView[];
  teammates: BotTeammateView[];
  sounds: BotSoundEvent[];
  comms: BotCommsMessage[];
  round: BotRoundView;
  match: BotMatchView;
  map: BotMapView;
  skillTier: string;
  /** Thông tin do server cung cấp cho UI bot (nhãn BOT luôn có). */
  displayName: string;
}

export interface BotCommand {
  forward: number;
  right: number;
  yaw: number;
  pitch: number;
  buttons: number;
  grenadeSlot: number;
  /** Mua đồ khi được phép (server sẽ kiểm tra tiền/vị trí). */
  buyItem?: string;
  /** Ghi chú debug cho overlay F3 (không gửi cho bot khác). */
  debug?: string;
}

export interface BotController {
  readonly id: number;
  readonly tier: string;
  think(view: BotSensorView): BotCommand;
  resetRound(roundNumber: number): void;
  getTelemetry(): BotTelemetrySnapshot;
}

export interface BotCombatEvent {
  type: string;
  attacker?: number | null;
  victim?: number;
  damage?: number;
  headshot?: boolean;
}

export interface BotTelemetrySnapshot {
  id: number;
  tier: string;
  role: string;
  reactionTimesMs: number[];
  crosshairHeightsM: number[];
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  hits: number;
  utilityThrown: number;
  counterStrafeSuccesses: number;
  counterStrafeAttempts: number;
  mistakes: string[];
  pathVariationM: number;
  averageSpeed: number;
  timeToKillMs: number[];
}

export interface BotSkillTier {
  label: string;
  reactionMedianMs: number;
  reactionSigma: number;
  aimErrorDeg: number;
  aimSpeedDegPerSec: number;
  flickOvershoot: number;
  sprayControl: number;
  burstDiscipline: number;
  counterStrafeSkill: number;
  utilityDiscipline: number;
  teamwork: number;
  patience: number;
  aggression: number;
  headshotAimBias: number;
  mistakeRate: number;
  commsChance: number;
  crosshairHeightM: number;
  preaimSkill: number;
  soundAwareness: number;
  peekSkill: number;
  tradeSkill: number;
  clutchSkill: number;
}

export interface BotSharedConfig {
  thinkHz: number;
  senseHz: number;
  fovDeg: number;
  hearingRangeM: number;
  hearingSigmaDeg: number;
  beliefCellM: number;
  beliefDecayPerSec: number;
  commsDelayMinSec: number;
  commsDelayMaxSec: number;
  commsWrongChance: number;
  maxTurnRateDegPerSec: number;
  headTurnSpeedDegPerSec: number;
  corpseInfoTtlSec: number;
  gunshotHearingMul: number;
  footstepHearingMul: number;
  smokeVisionPenalty: number;
  flashRecoveryAwareness: number;
  stuckWindowSec: number;
  stuckMinMoveM: number;
  navPathReplanSec: number;
  coverCheckRadiusM: number;
  peekHoldMinSec: number;
  peekHoldMaxSec: number;
  reactFirstSightPenalty: number;
}

export interface BotConfigFile {
  version: number;
  shared: BotSharedConfig;
  tiers: Record<string, BotSkillTier>;
  personality: Record<string, { min: number; max: number; roundJitter: number }>;
  roles: string[];
  tactics: Record<string, Record<string, { weightBase: number; minMoney: number; aggression: number }>>;
  aim: {
    fittsA: number;
    fittsB: number;
    minJerkDurationScale: number;
    microCorrectionHz: number;
    targetTrackingGain: number;
    recoilCompensationError: number;
    prefireChanceHighConfidence: number;
  };
  budget: { maxThinkPerTickMs: number; maxPerceptionChecksPerTick: number; pathCacheSeconds: number; workerThreads: number };
}

export function emptyTelemetry(id: number, tier: string, role = 'unknown'): BotTelemetrySnapshot {
  return {
    id, tier, role, reactionTimesMs: [], crosshairHeightsM: [], kills: 0, deaths: 0, headshots: 0,
    shotsFired: 0, hits: 0, utilityThrown: 0, counterStrafeSuccesses: 0, counterStrafeAttempts: 0,
    mistakes: [], pathVariationM: 0, averageSpeed: 0, timeToKillMs: [],
  };
}
