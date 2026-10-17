import { describe, expect, it } from 'vitest';
import {
  decodeInputPacket, decodeSnapshot, encodeInputPacket, encodeSnapshot, ProtocolCatalog,
  type NetPlayer, type NetSnapshot,
} from '@tactical/shared';
import { testData } from '../helpers';

function snapshot(tick: number, players: NetPlayer[]): NetSnapshot {
  return {
    protocol: 1, tick, serverTimeMs: tick * 16, ackSeq: 10, baseTick: 0,
    self: {
      id: 0, x: 1.5, y: 0, z: -3.25, vx: 2.1, vy: 0, vz: -1.2, yaw: 1.1, pitch: -0.2,
      grounded: true, crouching: false, walking: false, health: 87, armor: 63, alive: true,
      money: 3250, weaponIdx: 7, ammo: 21, reserve: 78, reloading: false, drawing: false,
      recoilShots: 4, scoped: false, blindUntilTick: 0, flashIntensity: 0, hasBomb: true,
      plantProgress: 0.4, defuseProgress: 0, planting: true, defusing: false,
      primaryIdx: 7, secondaryIdx: 1, grenades: [1, 2, 1, 0, 0], helmet: true, hasKit: false,
      activeSlot: 0, activeGrenade: 1, respawnAtTick: 0, kills: 5, deaths: 2, assists: 1, damageDealt: 480,
    },
    players, removedIds: [], grenades: [], smokes: [], fires: [], drops: [],
    round: {
      phase: 'live', roundNumber: 7, scoreT: 3, scoreCT: 3, phaseEndTick: 10000,
      bombPlanted: true, bombSite: 0, bombX: 8, bombY: 0, bombZ: -34, bombTimerEndTick: 12000,
      winner: 0, winReason: 0, overtime: false, lossStreakT: 0, lossStreakCT: 1,
    },
    events: [],
  };
}

const player = (id: number, x: number): NetPlayer => ({
  id, x, y: 0, z: 1, yaw: 0.5, pitch: 0, health: 100, armor: 50, alive: true,
  crouching: false, walking: false, grounded: true, team: id % 2 ? 'CT' : 'T',
  bot: id > 5, botReplacing: false, weaponIdx: 3, hasBomb: false, scoped: false,
});

describe('codec snapshot', () => {
  it('roundtrip self + round + độ chính xác lượng tử', () => {
    const data = testData();
    const cat = new ProtocolCatalog(data);
    const snap = snapshot(640, [player(1, 10), player(2, 20)]);
    const bytes = encodeSnapshot(snap, null, cat);
    expect(bytes.length).toBeLessThan(400);
    const out = decodeSnapshot(bytes, null, cat);
    expect(out.tick).toBe(640);
    expect(out.self.health).toBe(87);
    expect(out.self.money).toBe(3250);
    expect(out.self.planting).toBe(true);
    expect(out.self.x).toBeCloseTo(1.5, 2);
    expect(out.self.z).toBeCloseTo(-3.25, 2);
    expect(out.round.phase).toBe('live');
    expect(out.players.length).toBe(2);
    expect(out.players[1]!.x).toBeCloseTo(20, 1);
  });

  it('delta chỉ gửi trường thay đổi và ghép đúng base', () => {
    const data = testData();
    const cat = new ProtocolCatalog(data);
    const a = snapshot(100, [player(1, 10), player(2, 20)]);
    const b = snapshot(101, [player(1, 10), player(2, 25)]);
    const full = encodeSnapshot(a, null, cat);
    const delta = encodeSnapshot(b, a, cat);
    expect(delta.length).toBeLessThan(full.length);
    const decodedBase = decodeSnapshot(full, null, cat);
    const decoded = decodeSnapshot(delta, decodedBase, cat);
    expect(decoded.players.length).toBe(2);
    expect(decoded.players.find((p) => p.id === 2)!.x).toBeCloseTo(25, 1);
    expect(decoded.players.find((p) => p.id === 1)!.x).toBeCloseTo(10, 1);
  });

  it('roundtrip input packet', () => {
    const inputs = [
      { seq: 1, tick: 100, forward: 0.5, right: -1, yaw: 1.2, pitch: -0.3, buttons: 5, grenadeSlot: 1, viewTick: 99 },
      { seq: 2, tick: 101, forward: 0, right: 0.25, yaw: 1.3, pitch: 0.1, buttons: 0, grenadeSlot: 0, viewTick: 100 },
    ];
    const bytes = encodeInputPacket(inputs, 88, 77);
    const out = decodeInputPacket(bytes);
    expect(out.ackSnapshotTick).toBe(88);
    expect(out.inputs.length).toBe(2);
    expect(out.inputs[0]!.forward).toBeCloseTo(0.5, 3);
    expect(out.inputs[0]!.right).toBeCloseTo(-1, 3);
    expect(out.inputs[1]!.yaw).toBeCloseTo(1.3, 2);
  });
});
