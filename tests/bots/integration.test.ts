import { describe, expect, it } from 'vitest';
import {
  MatchSim, SimHost, TICK_RATE, type BotConfigFile,
} from '@tactical/shared';
import { BotSquad } from '@tactical/bots';
import { testBots, testData, testMap } from '../helpers';

describe('bot chạy trong mô phỏng', () => {
  it('5v5 deathmatch: bot di chuyển, bắn, không kẹt tường', () => {
    const data = testData();
    const map = testMap();
    const botConfig = testBots() as BotConfigFile;
    const sim = new MatchSim({
      config: {
        mode: 'deathmatch', mapId: 'sandstorm', roundsToWin: 13, freezeTimeSec: 15,
        roundTimeSec: 115, maxRounds: 24, overtimeEnabled: true, botFill: false,
        infiniteMoney: false, friendlyFire: false, warmupSec: 0,
      },
      data, map, seed: 5,
    });
    const squads = { T: new BotSquad('T', botConfig, 101), CT: new BotSquad('CT', botConfig, 202) };
    const entries: { id: number; name: string; tier: string; role: string; driver: { think(v: any): any } }[] = [];
    for (let i = 0; i < 10; i++) {
      const team = i < 5 ? 'T' : 'CT';
      const p = sim.addPlayer({ id: i, name: `Bot${i}`, team, isBot: true });
      p.spawnIndex = i % 5;
      const tier = ['rookie', 'regular', 'veteran', 'elite', 'pro'][i % 5]!;
      const bot = squads[team].addBot(i, tier);
      entries.push({ id: i, name: p.name, tier, role: bot.role, driver: { think: (v) => squads[team].think(v) } });
    }
    const host = new SimHost(sim, data, map, botConfig, entries);
    sim.start();
    const startPos = new Map(sim.players.map((p) => [p.id, { x: p.x, z: p.z }]));
    let shots = 0, kills = 0;
    for (let t = 0; t < TICK_RATE * 25; t++) {
      const events = host.step();
      shots += events.filter((e) => e.type === 'shot').length;
      kills += events.filter((e) => e.type === 'kill').length;
      for (const p of sim.players) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      }
    }
    const moved = sim.players.filter((p) => {
      const s = startPos.get(p.id)!;
      return Math.hypot(p.x - s.x, p.z - s.z) > 2;
    }).length;
    expect(moved).toBeGreaterThanOrEqual(6);
    expect(shots).toBeGreaterThan(5);
    const stuck = sim.players.filter((p) => map.collision.pointInsideSolid(p.x, p.y + 0.9, p.z)).length;
    expect(stuck).toBe(0);
    // Telemetry phải có dữ liệu
    const telemetry = [...squads.T.telemetry(), ...squads.CT.telemetry()];
    expect(telemetry.length).toBe(10);
    expect(telemetry.some((t) => t.reactionTimesMs.length > 0)).toBe(true);
    console.log(`bot shots=${shots} kills=${kills} moved=${moved}/10`);
  });
});
