import { describe, expect, it } from 'vitest';
import { buildSnapshot, MatchSim, ProtocolCatalog } from '@tactical/shared';
import { testData, testMap } from '../helpers';

describe('dựng snapshot', () => {
  it('lấy đúng self, đồng đội và round', () => {
    const data = testData();
    const sim = new MatchSim({ config: { mode: 'competitive', mapId: 'sandstorm', roundsToWin: 13, freezeTimeSec: 15, roundTimeSec: 115, maxRounds: 24, overtimeEnabled: true, botFill: false, infiniteMoney: false, friendlyFire: false, warmupSec: 0 }, data, map: testMap(), seed: 3 });
    sim.addPlayer({ id: 0, name: 'me', team: 'T', isBot: false });
    sim.addPlayer({ id: 1, name: 'ally', team: 'T', isBot: true });
    sim.addPlayer({ id: 2, name: 'enemy', team: 'CT', isBot: true });
    sim.start();
    const cat = new ProtocolCatalog(data);
    const snap = buildSnapshot(sim, 0, cat, 42);
    expect(snap.self.id).toBe(0);
    expect(snap.players.length).toBe(3);
    expect(snap.players.find((p) => p.id === 1)!.bot).toBe(true);
    expect(snap.ackSeq).toBe(42);
    expect(snap.round.phase).toBe(sim.round.phase);
    expect(snap.self.primaryIdx).toBe(255);
    expect(snap.self.secondaryIdx).not.toBe(255);
  });
});
