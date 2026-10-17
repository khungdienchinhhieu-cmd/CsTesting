import type { GrenadeKind, WeaponCategory } from './types';

export interface SpreadDef {
  stand: number; crouch: number; walk: number; run: number; jump: number; air: number;
  perShot: number; recoveryPerSec: number; firstShotMultiplier: number;
  scopedStand?: number; scopedCrouch?: number; scopedWalk?: number;
}
export interface RecoilDef {
  pattern: [number, number][];
  recoveryTime: number;
  horizontalVariance: number;
}
export type FireMode = 'auto' | 'semi' | 'pump' | 'bolt' | 'melee';

export interface WeaponDef {
  id: string;
  displayName: string;
  category: WeaponCategory;
  team: 'T' | 'CT' | 'both';
  price: number;
  damage: number;
  backstabDamage?: number;
  armorPenetration: number;
  fireMode: FireMode;
  rpm: number;
  magazine: number;
  reserve: number;
  reloadTime: number;
  reloadEmptyTime: number;
  drawTime: number;
  holsterTime: number;
  range: number;
  rangeModifier: number;
  penetration: number;
  moveSpeed: number;
  scopedMoveSpeed?: number;
  killReward: number;
  pellets: number;
  automatic: boolean;
  scopeFov: number;
  tracer: boolean;
  inspectTime: number;
  sound: string;
  slot: 'primary' | 'secondary' | 'knife';
  shellReload?: boolean;
  shellReloadTime?: number;
  spread: SpreadDef;
  recoil: RecoilDef;
}

export interface GrenadeDef {
  id: GrenadeKind;
  displayName: string;
  kind: GrenadeKind;
  team: 'T' | 'CT' | 'both';
  price: number;
  damage: number;
  radius: number;
  fuse: number;
  throwSpeed: number;
  throwSpeedWeak: number;
  restitution: number;
  friction: number;
  maxCarry: number;
  killReward?: number;
  duration?: number;
  dps?: number;
  deployTime?: number;
  maxBlindSec?: number;
}

export interface EquipmentDef {
  id: string;
  displayName: string;
  price: number;
  team: 'T' | 'CT' | 'both';
  armor: number;
  helmet: boolean;
  defuseKit?: boolean;
}

export interface HitboxMultipliers {
  head: number; chest: number; stomach: number; legs: number;
}

export interface ArmorRules {
  healthDamageFactor: number;
  armorDamageFactor: number;
  helmetHeadshotProtection: boolean;
}

export interface MovementDef {
  gravity: number; jumpVelocity: number; friction: number; stopSpeed: number;
  groundAccel: number; airAccel: number; airWishCap: number;
  walkMultiplier: number; crouchMultiplier: number; maxFallSpeed: number;
  stepHeight: number; playerRadius: number; standHeight: number; crouchHeight: number;
  standEye: number; crouchEye: number; maxSpeedTolerance: number; maxAngleDeltaPerTickDeg: number;
}
export interface RoundDef {
  freezeTimeSec: number; roundTimeSec: number; bombTimeSec: number; plantTimeSec: number;
  defuseTimeSec: number; defuseKitTimeSec: number; postRoundSec: number; warmupSec: number;
  buyTimeSec: number; roundsToWin: number; maxRounds: number; halftimeSwitchRound: number;
  overtimeEnabled: boolean; overtimeRounds: number; overtimeStartMoney: number;
  bombDamage: number; bombDamageRadius: number;
}
export interface CombatDef {
  maxLagCompMs: number; hitboxHistorySec: number; spreadRecoveryPerSec: number;
  recoilResetSec: number; armorHelmetHeadshotReduction: number;
  penetrationDamageFalloff: number; maxPenetrations: number; friendlyFire: boolean; selfDamage: boolean;
}
export interface SmokeDef {
  voxelGrid: number; voxelWorldSize: number; fillRadiusCells: number; softEdgeCells: number;
  bulletHoleRadiusM: number; heHoleRadiusM: number; deployTimeSec: number; durationSec: number; chokeDensity: number;
}
export interface FlashDef {
  maxBlindSec: number; minBlindSec: number; angleWeight: number; distanceFalloffM: number;
}
export interface BuyRules { allowDuringFreezeOnly: boolean; refundWindowSec: number; dropWeaponEnabled: boolean }
export interface RangeRules { infiniteMoney: boolean; targetRespawnSec: number; showDamage: boolean }

export interface GameplayDef {
  version: number;
  tickRate: number;
  movement: MovementDef;
  round: RoundDef;
  combat: CombatDef;
  bomb: { beepIntervalStartSec: number; beepIntervalEndSec: number; plantRadius: number; defusePromptSec: number };
  smoke: SmokeDef;
  flash: FlashDef;
  buy: BuyRules;
  range: RangeRules;
  matchmaking: Record<string, number>;
  chat: { maxLength: number; rateLimitPer10Sec: number; filterProfanity: boolean };
}

export interface EconomyDef {
  version: number;
  currency: string;
  startMoney: number; maxMoney: number; winReward: number;
  lossBase: number; lossStep: number; lossMax: number;
  plantReward: number; defuseReward: number;
  killRewardsByCategory: Record<WeaponCategory, number>;
  grenadeKillReward: number; teamkillPenalty: number; suicidePenalty: number;
  dropWeeklyLimit: number; dropCreditsMin: number; dropCreditsMax: number;
  marketFeePercent: number; marketMinPrice: number; marketMaxPrice: number;
  marketMaxOpenListings: number; marketTradeLockHours: number; dropTradeLockHours: number;
  newAccountDailyMarketLimit: number; highValueReviewThreshold: number; weeklyCreditsCap: number;
}

export interface RawWeaponsFile {
  version: number;
  hitboxMultipliers: HitboxMultipliers;
  armor: ArmorRules;
  weapons: WeaponDef[];
  grenades: GrenadeDef[];
  equipment: EquipmentDef[];
  buyMenu: Record<string, string[]>;
}
export type RawEconomyFile = EconomyDef;
export type RawGameplayFile = GameplayDef;

function assertNumber(obj: Record<string, unknown>, key: string, ctx: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`[data] ${ctx}.${key} phải là số hữu hạn`);
  return v;
}

export class GameData {
  readonly weapons = new Map<string, WeaponDef>();
  readonly grenades = new Map<GrenadeKind, GrenadeDef>();
  readonly equipment = new Map<string, EquipmentDef>();
  readonly buyMenu: Record<string, string[]>;
  readonly hitboxMultipliers: HitboxMultipliers;
  readonly armor: ArmorRules;
  readonly gameplay: GameplayDef;
  readonly economy: EconomyDef;
  readonly weaponsList: WeaponDef[];

  constructor(rawWeapons: RawWeaponsFile, rawGameplay: GameplayDef, rawEconomy: EconomyDef) {
    if (!rawWeapons || rawWeapons.version !== 1) throw new Error('[data] weapons.json version không hỗ trợ');
    if (!rawGameplay || rawGameplay.version !== 1) throw new Error('[data] gameplay.json version không hỗ trợ');
    if (!rawEconomy || rawEconomy.version !== 1) throw new Error('[data] economy.json version không hỗ trợ');
    this.hitboxMultipliers = rawWeapons.hitboxMultipliers;
    this.armor = rawWeapons.armor;
    this.gameplay = rawGameplay;
    this.economy = rawEconomy;
    this.buyMenu = rawWeapons.buyMenu;
    this.weaponsList = rawWeapons.weapons;
    for (const w of rawWeapons.weapons) {
      const rec = w as unknown as Record<string, unknown>;
      for (const k of ['price', 'damage', 'rpm', 'magazine', 'reloadTime', 'drawTime', 'range', 'moveSpeed']) {
        assertNumber(rec, k, `weapons.${w.id}`);
      }
      if (this.weapons.has(w.id)) throw new Error(`[data] trùng id súng: ${w.id}`);
      if (!Array.isArray(w.recoil?.pattern) || w.recoil.pattern.length === 0) throw new Error(`[data] ${w.id} thiếu recoil.pattern`);
      this.weapons.set(w.id, w);
    }
    for (const g of rawWeapons.grenades) {
      if (this.grenades.has(g.id)) throw new Error(`[data] trùng id lựu đạn: ${g.id}`);
      this.grenades.set(g.id, g);
    }
    for (const e of rawWeapons.equipment) this.equipment.set(e.id, e);
    const mv = rawGameplay.movement;
    for (const k of ['gravity', 'jumpVelocity', 'friction', 'groundAccel', 'playerRadius', 'standHeight']) {
      assertNumber(mv as unknown as Record<string, unknown>, k, 'gameplay.movement');
    }
    if (rawGameplay.tickRate !== 64) throw new Error('[data] tickRate phải là 64');
  }

  weapon(id: string): WeaponDef {
    const w = this.weapons.get(id);
    if (!w) throw new Error(`[data] không tìm thấy súng ${id}`);
    return w;
  }
  grenade(id: GrenadeKind): GrenadeDef {
    const g = this.grenades.get(id);
    if (!g) throw new Error(`[data] không tìm thấy lựu đạn ${id}`);
    return g;
  }
  /** Số tick giữa 2 phát bắn. */
  fireIntervalTicks(w: WeaponDef): number {
    return Math.max(1, Math.round((60 / w.rpm) * this.gameplay.tickRate));
  }
  reloadTicks(w: WeaponDef, empty: boolean): number {
    return Math.round((empty ? w.reloadEmptyTime : w.reloadTime) * this.gameplay.tickRate);
  }
  drawTicks(w: WeaponDef): number { return Math.round(w.drawTime * this.gameplay.tickRate); }
  plantTicks(): number { return Math.round(this.gameplay.round.plantTimeSec * this.gameplay.tickRate); }
  defuseTicks(hasKit: boolean): number {
    const sec = hasKit ? this.gameplay.round.defuseKitTimeSec : this.gameplay.round.defuseTimeSec;
    return Math.round(sec * this.gameplay.tickRate);
  }
  startingWeapons(team: 'T' | 'CT'): { primary: string | null; secondary: string; grenades: Record<GrenadeKind, number> } {
    return {
      primary: null,
      secondary: team === 'T' ? 'pistol_t' : 'pistol_ct',
      grenades: { he: 0, flash: 0, smoke: 0, molotov: 0, incendiary: 0 },
    };
  }
  buyItem(id: string): { kind: string; ref: string; price: number; team: string } | null {
    const w = this.weapons.get(id);
    if (w) return { kind: 'weapon', ref: w.id, price: w.price, team: w.team };
    const g = this.grenades.get(id as GrenadeKind);
    if (g) return { kind: 'grenade', ref: g.id, price: g.price, team: g.team };
    const e = this.equipment.get(id);
    if (e) return { kind: e.defuseKit ? 'kit' : e.helmet ? 'helmet' : 'armor', ref: e.id, price: e.price, team: e.team };
    return null;
  }
}

export function createGameData(rawWeapons: RawWeaponsFile, rawGameplay: GameplayDef, rawEconomy: EconomyDef): GameData {
  return new GameData(rawWeapons, rawGameplay, rawEconomy);
}
