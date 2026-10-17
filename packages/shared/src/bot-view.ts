// Xây BotSensorView từ mô phỏng — CHỈ server dùng. Bot không bao giờ chạm MatchSim.
import type {
  BotBuyOption, BotCommsMessage, BotEnemyView, BotMapView, BotMatchView, BotRoundView, BotSensorView, BotSelfState, BotSoundEvent, BotTeammateView,
  BotWeaponView,
} from './bot-api';
import type { BotConfigFile } from './bot-api';
import type { GameData, WeaponDef } from './data';
import type { GameMap } from './map';
import { clamp, distVec3, wrapAngle } from './math';
import type { MatchSim } from './match';
import { TICK_RATE } from './constants';
import type { GameEvent, GrenadeKind, PlayerState } from './types';

export interface BotRosterEntry { id: number; name: string; tier: string; role: string }

const SOUND_KIND: Partial<Record<GameEvent['type'], BotSoundEvent['kind']>> = {
  footstep: 'footstep',
  shot: 'gunshot',
  reload_start: 'reload',
  reload_end: 'reload',
  bomb_beep: 'bomb_beep',
  plant_start: 'plant',
  defuse_start: 'defuse',
  grenade_throw: 'grenade_bounce',
  grenade_explode: 'explosion',
  scope: 'scope',
  pickup: 'pickup',
};

export function weaponToBotView(w: WeaponDef): BotWeaponView {
  return {
    id: w.id, category: w.category, fireMode: w.fireMode, rpm: w.rpm,
    magazine: w.magazine, reserve: w.reserve,
    spreadStand: w.spread.stand, spreadRun: w.spread.run,
    recoil: w.recoil.pattern, reloadSec: w.reloadTime, reloadEmptySec: w.reloadEmptyTime,
    range: w.range, pellets: w.pellets, price: w.price,
  };
}

function grenadeCounts(p: PlayerState): Record<GrenadeKind, number> { return { ...p.loadout.grenades }; }

export class BotViewBuilder {
  constructor(
    private readonly sim: MatchSim,
    private readonly data: GameData,
    private readonly map: GameMap,
    private readonly botConfig: BotConfigFile,
    private readonly random: () => number = Math.random,
  ) {}

  build(
    bot: PlayerState,
    roster: Map<number, BotRosterEntry>,
    recentEvents: readonly GameEvent[],
    comms: readonly BotCommsMessage[],
  ): BotSensorView {
    const self = this.buildSelf(bot);
    const enemies: BotEnemyView[] = [];
    const teammates: BotTeammateView[] = [];
    const fovHalf = (this.botConfig.shared.fovDeg * Math.PI) / 360;
    for (const other of this.sim.players) {
      if (other.id === bot.id || !other.alive) continue;
      if (other.team === bot.team) {
        teammates.push({
          id: other.id, x: other.x, y: other.y, z: other.z,
          health: other.health, armor: other.armor, alive: other.alive,
          hasBomb: other.hasBomb, weaponId: other.activeWeapon, weaponCategory: this.data.weapons.get(other.activeWeapon)?.category ?? 'rifle',
          distance: distVec3({ x: bot.x, y: bot.eyeY, z: bot.z }, { x: other.x, y: other.eyeY, z: other.z }),
          inMyFov: this.inFov(bot, other, fovHalf),
        });
        continue;
      }
      if (!other.alive) continue;
      if (this.sim.isBlinded(bot)) continue;
      if (!this.inFov(bot, other, fovHalf)) continue;
      if (!this.sim.canSeePoint(bot, other.x, other.eyeY, other.z)
        && !this.sim.canSeePoint(bot, other.x, other.y + 1.2, other.z)
        && !this.sim.canSeePoint(bot, other.x, other.y + 0.85, other.z)) continue;
      const parts: ('head' | 'chest' | 'stomach' | 'legs')[] = [];
      if (this.sim.canSeePoint(bot, other.x, other.eyeY, other.z)) parts.push('head');
      if (this.sim.canSeePoint(bot, other.x, other.y + 1.25, other.z)) parts.push('chest');
      if (this.sim.canSeePoint(bot, other.x, other.y + 0.95, other.z)) parts.push('stomach');
      if (this.sim.canSeePoint(bot, other.x, other.y + 0.45, other.z)) parts.push('legs');
      if (parts.length === 0) continue;
      const dx = other.x - bot.x, dz = other.z - bot.z;
      const targetYaw = Math.atan2(dx, dz);
      const wy = this.data.weapons.get(other.activeWeapon);
      enemies.push({
        id: other.id, x: other.x, y: other.y, z: other.z,
        vx: other.vx, vy: other.vy, vz: other.vz,
        yaw: other.yaw, pitch: other.pitch,
        health: other.health, armor: other.armor, helmet: other.helmet,
        weaponId: other.activeWeapon, weaponCategory: wy?.category ?? 'rifle',
        crouching: other.crouching, grounded: other.grounded,
        distance: Math.sqrt(dx * dx + dz * dz),
        angleOffAim: Math.abs(wrapAngle(bot.yaw - targetYaw)),
        exposure: parts.length / 4,
        visibleParts: parts,
        lastSeenAgeSec: 0,
        firstSeenTick: this.sim.tick,
        isBot: other.isBot,
      });
    }
    const sounds = this.buildSounds(bot, recentEvents);
    return {
      tick: this.sim.tick,
      self,
      enemies,
      teammates,
      sounds,
      comms: [...comms],
      round: this.buildRound(bot),
      match: this.buildMatch(bot),
      map: this.buildMap(),
      skillTier: roster.get(bot.id)?.tier ?? 'regular',
      displayName: bot.name,
    };
  }

  private inFov(bot: PlayerState, target: PlayerState, fovHalf: number): boolean {
    const dx = target.x - bot.x, dz = target.z - bot.z;
    const targetYaw = Math.atan2(dx, dz);
    return Math.abs(wrapAngle(targetYaw - bot.yaw)) <= fovHalf;
  }

  private buildSelf(p: PlayerState): BotSelfState {
    const w = this.data.weapons.get(p.activeWeapon) ?? this.data.weapon('knife');
    const blindRemaining = Math.max(0, (p.blindUntilTick - this.sim.tick) / TICK_RATE);
    return {
      id: p.id, team: p.team, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz,
      yaw: p.yaw, pitch: p.pitch, health: p.health, armor: p.armor, helmet: p.helmet,
      crouching: p.crouching, walking: p.walking, grounded: p.grounded,
      weaponId: p.activeWeapon, weaponCategory: w.category, ammo: p.ammo[p.activeWeapon]?.mag ?? 0,
      reserve: p.ammo[p.activeWeapon]?.reserve ?? 0,
      activeSlot: p.activeSlot, activeGrenade: p.activeGrenade,
      grenades: grenadeCounts(p), hasBomb: p.hasBomb, hasDefuseKit: p.loadout.defuseKit,
      money: p.money, reloading: p.reloadingUntilTick > this.sim.tick, blinded: this.sim.isBlinded(p),
      blindRemainingSec: blindRemaining, recoilShots: p.recoilShots, scoped: p.scoped, alive: p.alive,
      weapon: weaponToBotView(w),
      primaryId: p.loadout.primary, secondaryId: p.loadout.secondary,
      recentHitConfirm: this.sim.tick - p.lastDamageTick < 8,
    };
  }

  private buildRound(bot: PlayerState): BotRoundView {
    const r = this.sim.round;
    const timeLeft = Math.max(0, (r.phaseEndTick - this.sim.tick) / TICK_RATE);
    const bombLeft = r.bombPlanted ? Math.max(0, (r.bombTimerEndTick - this.sim.tick) / TICK_RATE) : 0;
    const carrier = this.sim.players.find((p) => p.hasBomb);
    return {
      phase: r.phase, roundNumber: r.roundNumber, scoreT: r.scoreT, scoreCT: r.scoreCT,
      phaseTimeLeftSec: timeLeft, bombPlanted: r.bombPlanted, bombSite: r.bombSite,
      bombX: r.bombX, bombY: r.bombY, bombZ: r.bombZ, bombTimeLeftSec: bombLeft,
      carriedByMe: bot.hasBomb, bombCarriedByTeammate: !!carrier && carrier.id !== bot.id,
      bombDropped: this.sim.bombDropped,
      bombDroppedX: this.sim.bombDropX, bombDroppedY: this.sim.bombDropY, bombDroppedZ: this.sim.bombDropZ,
      bombBeingDefused: r.bombBeingDefusedBy !== null,
      plantProgress: bot.plantProgress, defuseProgress: bot.defuseProgress,
      siteA: this.map.json.sites.find((s) => s.id === 'A'),
      siteB: this.map.json.sites.find((s) => s.id === 'B'),
    };
  }

  private buildMatch(bot: PlayerState): BotMatchView {
    const teammatesAlive = this.sim.aliveCount(bot.team);
    const enemiesAlive = this.sim.aliveCount(bot.team === 'T' ? 'CT' : 'T');
    const streak = bot.team === 'T' ? this.sim.round.lossStreakT : this.sim.round.lossStreakCT;
    const ownEconomy: 'eco' | 'force' | 'full' = bot.money < 2000 ? 'eco' : bot.money < 4500 ? 'force' : 'full';
    const buyOptions: BotBuyOption[] = [];
    for (const w of this.data.weaponsList) {
      if (w.team !== 'both' && w.team !== bot.team) continue;
      if (w.slot === 'knife') continue;
      buyOptions.push({ id: w.id, price: w.price, kind: 'weapon', category: w.category });
    }
    for (const g of this.data.grenades.values()) {
      if (g.team !== 'both' && g.team !== bot.team) continue;
      buyOptions.push({ id: g.id, price: g.price, kind: 'grenade', category: 'grenade' });
    }
    for (const e of this.data.equipment.values()) {
      if (e.team !== 'both' && e.team !== bot.team) continue;
      buyOptions.push({ id: e.id, price: e.price, kind: e.defuseKit ? 'kit' : e.helmet ? 'helmet' : 'armor', category: 'gear' });
    }
    return {
      mode: this.sim.config.mode, team: bot.team, teammatesAlive, enemiesAlive,
      timeSinceRoundStartSec: Math.max(0, (this.sim.tick - this.sim.round.roundStartTick) / TICK_RATE),
      lossStreak: streak, enemyEconomyEstimate: 'unknown', ownEconomy, buyOptions,
    };
  }

  private buildMap(): BotMapView {
    return {
      id: this.map.json.id,
      callouts: this.map.json.callouts.map((c) => ({ name: c.name, rect: c.rect })),
      sites: this.map.json.sites,
      buyZones: this.map.json.buyZones,
      spawns: this.map.json.spawns,
      bounds: this.map.json.bounds,
      nav: {
        findPath: (sx, sz, gx, gz, out) => this.sim.nav.findPath(sx, sz, gx, gz, out),
        canWalkStraight: (ax, az, bx, bz) => this.sim.nav.canWalkStraight(ax, az, bx, bz),
        randomPointNear: (x, z, r) => this.sim.nav.randomWalkableNear(x, z, r, this.random),
        isWalkable: (x, z) => this.map.isWalkableWorld(x, z),
      },
    };
  }

  private buildSounds(bot: PlayerState, recentEvents: readonly GameEvent[]): BotSoundEvent[] {
    const out: BotSoundEvent[] = [];
    const cfg = this.botConfig.shared;
    const now = this.sim.tick;
    for (const e of recentEvents) {
      const kind = SOUND_KIND[e.type];
      if (!kind) continue;
      if ((e.type === 'shot' || e.type === 'footstep' || e.type === 'reload_start' || e.type === 'weapon_switch' || e.type === 'scope') && 'playerId' in e && e.playerId === bot.id) continue;
      let x = 0, y = 0, z = 0, loudness = 1, sourceId: number | null = null;
      if ('x' in e && typeof e.x === 'number') { x = e.x; y = e.y ?? 0; z = e.z; }
      if ('playerId' in e) sourceId = e.playerId;
      if (e.type === 'shot') loudness = 1.0;
      else if (e.type === 'footstep') loudness = 0.42;
      else if (e.type === 'reload_start' || e.type === 'reload_end') loudness = 0.3;
      else if (e.type === 'bomb_beep') loudness = 0.7;
      else if (e.type === 'grenade_explode' || e.type === 'bomb_exploded') loudness = 1.4;
      const dist = distVec3({ x: bot.x, y: bot.eyeY, z: bot.z }, { x, y, z });
      const range = cfg.hearingRangeM * (kind === 'gunshot' ? cfg.gunshotHearingMul : kind === 'footstep' ? cfg.footstepHearingMul : 1);
      if (dist > range * loudness) continue;
      // Vị trí thô: làm tròn 2m + nhiễu theo khoảng cách/tay nghề
      const sigma = clamp(dist / range, 0, 1) * 3.2;
      const nx = Math.round((x + (this.random() - 0.5) * sigma) / 2) * 2;
      const nz = Math.round((z + (this.random() - 0.5) * sigma) / 2) * 2;
      const src = sourceId !== null ? this.sim.byId.get(sourceId) : undefined;
      out.push({
        kind, x: nx, y, z: nz, tick: now,
        loudness: clamp(loudness * (1 - dist / (range * 1.1)), 0, 1),
        confidence: clamp(1 - dist / range, 0.15, 0.95),
        fromTeammate: !!src && src.team === bot.team,
        teammateId: src && src.team === bot.team ? src.id : undefined,
      });
      if (out.length >= 24) break;
    }
    return out;
  }
}
