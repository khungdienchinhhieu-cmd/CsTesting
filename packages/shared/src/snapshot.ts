import type { MatchSim } from './match';
import type { GameEvent, PlayerState, Team } from './types';
import type { NetDrop, NetFire, NetGrenade, NetPlayer, NetRound, NetSelf, NetSmoke, NetSnapshot } from './protocol';
import type { ProtocolCatalog } from './protocol';

/** Chuyển trạng thái mô phỏng sang snapshot mạng (quantize ở bước encode). */
export function buildSnapshot(
  sim: MatchSim, selfId: number, cat: ProtocolCatalog, ackSeq: number, events: GameEvent[] = [],
): NetSnapshot {
  const self = sim.byId.get(selfId);
  if (!self) throw new Error(`[snapshot] không có người chơi ${selfId}`);
  const players: NetPlayer[] = [];
  for (const p of sim.players) {
    if (!p.connected) continue;
    players.push({
      id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      health: p.health, armor: p.armor, alive: p.alive, crouching: p.crouching,
      walking: p.walking, grounded: p.grounded, team: p.team, bot: p.isBot,
      botReplacing: p.botReplacing, weaponIdx: cat.weaponIdx(p.activeWeapon),
      hasBomb: p.hasBomb, scoped: p.scoped,
    });
  }
  const smokes: NetSmoke[] = sim.smokes.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, radius: s.radius, endTick: s.endTick }));
  const fires: NetFire[] = sim.fires.map((f) => ({ id: f.id, x: f.x, z: f.z, radius: f.radius, endTick: f.endTick }));
  const grenades: NetGrenade[] = sim.grenades.map((g) => ({ id: g.id, kind: g.kind, x: g.x, y: g.y, z: g.z }));
  const drops: NetDrop[] = sim.dropped.map((d) => ({ id: d.id, weaponIdx: cat.weaponIdx(d.weaponId), x: d.x, y: d.y, z: d.z, ammo: d.ammo }));
  const r = sim.round;
  const round: NetRound = {
    phase: r.phase, roundNumber: r.roundNumber, scoreT: r.scoreT, scoreCT: r.scoreCT,
    phaseEndTick: r.phaseEndTick, bombPlanted: r.bombPlanted, bombSite: r.bombSite === 'B' ? 1 : 0,
    bombX: r.bombX, bombY: r.bombY, bombZ: r.bombZ, bombTimerEndTick: r.bombTimerEndTick,
    winner: r.winner === 'T' ? 0 : r.winner === 'CT' ? 1 : 0,
    winReason: r.winReason === 'elimination' ? 0 : r.winReason === 'time' ? 1 : r.winReason === 'bomb' ? 2 : r.winReason === 'defuse' ? 3 : 0,
    overtime: r.overtime, lossStreakT: r.lossStreakT, lossStreakCT: r.lossStreakCT,
  };
  return {
    protocol: 1, tick: sim.tick, serverTimeMs: Math.round(sim.tick * 1000 / 64), ackSeq,
    baseTick: 0, self: selfSnapshot(self, cat), players, removedIds: [],
    grenades, smokes, fires, drops, round, events,
  };
}

export function selfSnapshot(p: PlayerState, cat: ProtocolCatalog): NetSelf {
  const ammo = p.ammo[p.activeWeapon];
  const slotCode = p.activeSlot === 'primary' ? 0 : p.activeSlot === 'secondary' ? 1 : p.activeSlot === 'knife' ? 2 : p.activeSlot === 'grenade' ? 3 : 4;
  const grenadeCode = p.activeGrenade ? ['he', 'flash', 'smoke', 'molotov', 'incendiary'].indexOf(p.activeGrenade) : 0;
  return {
    id: p.id, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz,
    yaw: p.yaw, pitch: p.pitch, grounded: p.grounded, crouching: p.crouching, walking: p.walking,
    health: Math.max(0, Math.round(p.health)), armor: Math.max(0, Math.round(p.armor)), alive: p.alive, money: Math.round(p.money),
    weaponIdx: cat.weaponIdx(p.activeWeapon), ammo: ammo?.mag ?? 0, reserve: ammo?.reserve ?? 0,
    reloading: p.reloadingUntilTick > 0, drawing: p.drawingUntilTick > 0, recoilShots: p.recoilShots,
    scoped: p.scoped, blindUntilTick: p.blindUntilTick, flashIntensity: p.flashIntensity,
    hasBomb: p.hasBomb, plantProgress: p.plantProgress, defuseProgress: p.defuseProgress,
    planting: p.planting, defusing: p.defusing,
    primaryIdx: p.loadout.primary ? cat.weaponIdx(p.loadout.primary) : 255,
    secondaryIdx: p.loadout.secondary ? cat.weaponIdx(p.loadout.secondary) : 255,
    grenades: ['he', 'flash', 'smoke', 'molotov', 'incendiary'].map((k) => p.loadout.grenades[k as keyof typeof p.loadout.grenades] ?? 0),
    helmet: p.helmet, hasKit: p.loadout.defuseKit, activeSlot: slotCode, activeGrenade: grenadeCode,
    respawnAtTick: p.respawnAtTick, kills: p.kills, deaths: p.deaths, assists: p.assists, damageDealt: p.damageDealt,
  };
}

/** Số tick sống còn lại của round (cho HUD). */
export function ticksLeft(sim: MatchSim): number { return Math.max(0, sim.round.phaseEndTick - sim.tick); }

export function teamOf(sim: MatchSim, id: number): Team { return sim.byId.get(id)?.team ?? 'T'; }
