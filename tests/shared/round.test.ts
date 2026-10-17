import { describe, expect, it } from 'vitest';
import { Buttons, MatchSim, TICK_RATE, type InputCommand } from '@tactical/shared';
import { makeInput, testData, testMap } from '../helpers';

function setup() {
  const data = testData();
  const map = testMap();
  const sim = new MatchSim({
    config: {
      mode: 'competitive', mapId: 'sandstorm', roundsToWin: 13, freezeTimeSec: 15,
      roundTimeSec: 115, maxRounds: 24, overtimeEnabled: true, botFill: false,
      infiniteMoney: false, friendlyFire: false, warmupSec: 0,
    },
    data, map, seed: 11,
  });
  const t = sim.addPlayer({ id: 0, name: 'T', team: 'T', isBot: false });
  const ct = sim.addPlayer({ id: 1, name: 'CT', team: 'CT', isBot: false });
  sim.start();
  const killPhase = () => {
    sim.round.phase = 'live';
    sim.round.roundStartTick = sim.tick;
    sim.round.phaseEndTick = sim.tick + TICK_RATE * 115;
  };
  return { sim, t, ct, data, killPhase };
}

function feed(sim: MatchSim, id: number, buttons: number, ticks: number, seqStart: number): number {
  let seq = seqStart;
  for (let i = 0; i < ticks; i++) {
    const cmd: InputCommand = makeInput(seq++, { buttons, viewTick: sim.tick });
    sim.submitInput(id, cmd);
    sim.step();
  }
  return seq;
}

describe('vòng đấu, bom và kinh tế', () => {
  it('bắt đầu ở freeze, mua vũ khí và trừ tiền', () => {
    const { sim, t } = setup();
    expect(sim.round.phase).toBe('freeze');
    t.money = 3000;
    t.x = -41.5; t.z = -2; t.y = 0; // trong buy zone T
    const res = sim.buy(0, 'rifle_t');
    expect(res.ok).toBe(true);
    expect(t.loadout.primary).toBe('rifle_t');
    expect(t.money).toBe(300);
    const res2 = sim.buy(0, 'rifle_t');
    expect(res2.ok).toBe(false); // không đủ tiền
  });

  it('đặt bom rồi CT gỡ bom thắng vòng', () => {
    const { sim, t, ct, killPhase } = setup();
    killPhase();
    t.hasBomb = true;
    t.x = 8; t.y = 0; t.z = -34;
    ct.x = 40; ct.z = 0;
    let seq = 1;
    seq = feed(sim, 0, Buttons.Use, Math.round(3.4 * TICK_RATE), seq);
    expect(sim.round.bombPlanted).toBe(true);
    expect(sim.round.bombSite).toBe('A');
    ct.x = sim.round.bombX + 0.7; ct.y = 0; ct.z = sim.round.bombZ;
    const before = sim.round.scoreCT;
    seq = feed(sim, 1, Buttons.Use, Math.round(10.2 * TICK_RATE), 1);
    expect(sim.round.scoreCT).toBe(before + 1);
    expect(sim.round.winReason).toBe('defuse');
    expect(ct.money).toBeGreaterThan(800);
    void seq;
  });

  it('bom nổ thì T thắng', () => {
    const { sim, t, ct, killPhase } = setup();
    killPhase();
    t.hasBomb = true;
    t.x = 8; t.y = 0; t.z = -34;
    let seq = 1;
    seq = feed(sim, 0, Buttons.Use, Math.round(3.3 * TICK_RATE), seq);
    expect(sim.round.bombPlanted).toBe(true);
    // đưa CT ra xa để không bị giết
    ct.x = 50; ct.z = 0;
    const before = sim.round.scoreT;
    for (let i = 0; i < Math.round(41 * TICK_RATE); i++) {
      sim.submitInput(0, makeInput(seq++, { viewTick: sim.tick }));
      sim.step();
      if (sim.round.phase !== 'live') break;
    }
    expect(sim.round.scoreT).toBe(before + 1);
    expect(sim.round.winReason).toBe('bomb');
  });

  it('hết giờ khi chưa đặt bom thì CT thắng', () => {
    const { sim, t, ct, killPhase } = setup();
    killPhase();
    t.x = 40; ct.x = 40; t.z = 20; ct.z = 20;
    sim.round.phaseEndTick = sim.tick + 2;
    let seq = 1;
    for (let i = 0; i < 5; i++) { sim.submitInput(0, makeInput(seq++)); sim.step(); }
    expect(sim.round.winner).toBe('CT');
    expect(sim.round.winReason).toBe('time');
  });

  it('giết hết một phe thì phe kia thắng', () => {
    const { sim, t, ct, killPhase, data } = setup();
    killPhase();
    const w = data.weapon('rifle_t');
    sim.damagePlayer(ct, t, 500, 'chest', w, ct.x, ct.eyeY, ct.z, 'rifle');
    let seq = 1;
    for (let i = 0; i < 3; i++) { sim.submitInput(0, makeInput(seq++)); sim.step(); }
    expect(ct.alive).toBe(false);
    expect(sim.round.winner).toBe('T');
    expect(t.kills).toBe(1);
    expect(t.money).toBeGreaterThan(800);
  });
});
