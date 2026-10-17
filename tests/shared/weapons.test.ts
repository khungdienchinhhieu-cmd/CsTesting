import { describe, expect, it } from 'vitest';
import {
  computeDamage, createPlayerState, computeShotDirection, Rng, rangeAdjustedDamage,
  MatchSim, TICK_RATE, Buttons, type GameEvent,
} from '@tactical/shared';
import { makeInput, testData, testMap } from '../helpers';

describe('sát thương và giáp', () => {
  it('headshot x4 khi không giáp', () => {
    const data = testData();
    const victim = createPlayerState(1, 'v', 'CT', true, data);
    const w = data.weapon('rifle_t');
    const res = computeDamage(victim, w.damage, 'head', w, data);
    expect(res.healthDamage).toBeCloseTo(100, 5); // sát thương thực tế bị chặn bởi máu còn lại
    expect(res.lethal).toBe(true);
  });

  it('giáp + mũ giảm headshot đúng hệ số', () => {
    const data = testData();
    const victim = createPlayerState(1, 'v', 'CT', true, data);
    victim.armor = 100; victim.helmet = true;
    const w = data.weapon('rifle_t');
    const res = computeDamage(victim, w.damage, 'head', w, data);
    expect(res.healthDamage).toBeCloseTo(36 * 4 * 0.775 * 0.5, 4);
    expect(res.armorDamage).toBeGreaterThan(0);
  });

  it('giáp không bảo vệ chân', () => {
    const data = testData();
    const victim = createPlayerState(1, 'v', 'CT', true, data);
    victim.armor = 100;
    const w = data.weapon('rifle_t');
    const res = computeDamage(victim, w.damage, 'legs', w, data);
    expect(res.healthDamage).toBeCloseTo(36 * 0.75, 4);
  });

  it('damage falloff theo khoảng cách', () => {
    expect(rangeAdjustedDamage(100, 0, 0.98)).toBe(100);
    expect(rangeAdjustedDamage(100, 50, 0.98)).toBeLessThan(100);
    expect(rangeAdjustedDamage(100, 50, 0.98)).toBeGreaterThan(80);
  });

  it('hướng bắn tất định khi cùng seed', () => {
    const data = testData();
    const p = createPlayerState(1, 'p', 'T', false, data);
    const w = data.weapon('rifle_t');
    const outA = { yaw: 0, pitch: 0 };
    const outB = { yaw: 0, pitch: 0 };
    computeShotDirection(p, w, new Rng(42), data, outA);
    computeShotDirection(p, w, new Rng(42), data, outB);
    expect(outA.yaw).toBeCloseTo(outB.yaw, 10);
    expect(outA.pitch).toBeCloseTo(outB.pitch, 10);
  });
});

describe('bắn, nạp đạn trong MatchSim', () => {
  function setup() {
    const data = testData();
    const map = testMap();
    const sim = new MatchSim({
      config: { mode: 'custom', mapId: 'sandstorm', roundsToWin: 13, freezeTimeSec: 15, roundTimeSec: 115, maxRounds: 24, overtimeEnabled: true, botFill: false, infiniteMoney: false, friendlyFire: false, warmupSec: 0 },
      data, map, seed: 7,
    });
    const p = sim.addPlayer({ id: 0, name: 'shooter', team: 'T', isBot: false });
    const dummy = sim.addPlayer({ id: 1, name: 'dummy', team: 'CT', isBot: false });
    sim.start();
    dummy.x = 40; dummy.y = 0; dummy.z = 20; dummy.eyeY = 1.64;
    sim.round.phase = 'live';
    sim.round.roundStartTick = sim.tick;
    sim.round.phaseEndTick = sim.tick + TICK_RATE * 115;
    p.x = 0; p.y = 0; p.z = 0; p.eyeY = 1.64; p.grounded = true;
    p.loadout.primary = 'rifle_t';
    p.ammo['rifle_t'] = { mag: 30, reserve: 90 };
    p.activeWeapon = 'rifle_t'; p.activeSlot = 'primary'; p.drawingUntilTick = 0;
    return { sim, p, data };
  }

  function hold(sim: MatchSim, p: { yaw: number; pitch: number }, buttons: number, ticks: number, startSeq = 1) {
    const events: GameEvent[] = [];
    let seq = startSeq;
    for (let i = 0; i < ticks; i++) {
      sim.submitInput(0, makeInput(seq++, { buttons, yaw: p.yaw, pitch: p.pitch, viewTick: sim.tick }));
      events.push(...sim.step());
    }
    return { events, seq };
  }

  it('tốc độ bắn xấp xỉ rpm', () => {
    const { sim, p } = setup();
    const { events } = hold(sim, p, Buttons.Fire, 64);
    const shots = events.filter((e) => e.type === 'shot').length;
    expect(shots).toBeGreaterThanOrEqual(8);
    expect(shots).toBeLessThanOrEqual(11);
  });

  it('hết đạn thì phải nạp, nạp xong đầy băng và trừ reserve', () => {
    const { sim, p } = setup();
    p.ammo['rifle_t'] = { mag: 0, reserve: 60 };
    let seq = 1;
    sim.submitInput(0, makeInput(seq++, { buttons: Buttons.Reload }));
    const events: GameEvent[] = [];
    for (let i = 0; i < Math.round(3.2 * 64); i++) {
      sim.submitInput(0, makeInput(seq++));
      events.push(...sim.step());
    }
    expect(events.some((e) => e.type === 'reload_start')).toBe(true);
    expect(events.some((e) => e.type === 'reload_end')).toBe(true);
    expect(p.ammo['rifle_t']!.mag).toBe(30);
    expect(p.ammo['rifle_t']!.reserve).toBe(30);
  });

  it('recoil index tăng và reset sau khi ngừng bắn', () => {
    const { sim, p } = setup();
    hold(sim, p, Buttons.Fire, 25);
    expect(p.recoilShots).toBeGreaterThan(3);
    let seq = 100;
    for (let i = 0; i < Math.round(0.6 * 64); i++) {
      sim.submitInput(0, makeInput(seq++));
      sim.step();
    }
    expect(p.recoilShots).toBe(0);
  });
});
