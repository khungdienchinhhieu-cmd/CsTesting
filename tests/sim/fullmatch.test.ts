import { describe, expect, it } from 'vitest';
import { MatchSim, SimHost, TICK_RATE, type BotConfigFile } from '@tactical/shared';
import { BotSquad } from '@tactical/bots';
import { testBots, testData, testMap } from '../helpers';

function makeMatch(mode: 'quick' | 'competitive' = 'quick') {
  const data = testData();
  const map = testMap();
  const cfg = testBots() as BotConfigFile;
  const sim = new MatchSim({
    config: {
      mode, mapId: 'sandstorm', roundsToWin: 2, maxRounds: 4, freezeTimeSec: 3, roundTimeSec: 32,
      overtimeEnabled: false, botFill: false, infiniteMoney: false, friendlyFire: false, warmupSec: 0,
    },
    data, map, seed: 2026,
  });
  const squads = { T: new BotSquad('T', cfg, 501), CT: new BotSquad('CT', cfg, 902) };
  const entries: { id: number; name: string; tier: string; role: string; driver: { think: (v: never) => never } }[] = [];
  const tiers = ['rookie', 'regular', 'veteran', 'elite', 'pro'];
  for (let i = 0; i < 10; i++) {
    const team = i < 5 ? 'T' : 'CT';
    const name = `BOT ${team}${i}`;
    sim.addPlayer({ id: i, name, team, isBot: true });
    const bot = squads[team].addBot(i, tiers[i % 5]!);
    entries.push({ id: i, name, tier: tiers[i % 5]!, role: bot.role, driver: { think: (v) => squads[team].think(v as never) as never } });
  }
  const host = new SimHost(sim, data, map, cfg, entries);
  sim.start();
  return { sim, host, squads, data };
}

describe('trận đấu đầy đủ với bot', () => {
  it('bot mua súng, giao tranh và kết thúc vòng', () => {
    const { sim, host, squads } = makeMatch('quick');
    let shots = 0, kills = 0, plants = 0, defuses = 0, roundEnds = 0, matchEnds = 0;
    const weaponsBought = new Set<string>();
    const maxTicks = TICK_RATE * 180;
    for (let t = 0; t < maxTicks; t++) {
      const events = host.step();
      for (const e of events) { squads.T.observeEvent(e as never); squads.CT.observeEvent(e as never); }
      for (const e of events) {
        if (e.type === 'shot') shots++;
        if (e.type === 'kill') kills++;
        if (e.type === 'bomb_planted') plants++;
        if (e.type === 'bomb_defused') defuses++;
        if (e.type === 'buy') weaponsBought.add(e.itemId);
        if (e.type === 'round_end') roundEnds++;
        if (e.type === 'match_end') matchEnds++;
      }
      if (matchEnds > 0) break;
      for (const p of sim.players) {
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      }
    }
    console.log(`shots=${shots} kills=${kills} plants=${plants} defuses=${defuses} rounds=${roundEnds} matchEnds=${matchEnds} tick=${sim.tick}`);
    console.log('bought', [...weaponsBought].join(','));
    console.log('score', sim.round.scoreT, sim.round.scoreCT, 'phase', sim.round.phase);
    const telemetry = [...squads.T.telemetry(), ...squads.CT.telemetry()];
    console.log('telemetry', telemetry.map((t) => `${t.id}:k${t.kills}/d${t.deaths}/sh${t.shotsFired}/hits${t.hits}`).join(' '));
    console.log('mistakes', telemetry.flatMap((t) => t.mistakes).slice(0, 8).join(','));
    expect(shots).toBeGreaterThan(50);
    expect(weaponsBought.size).toBeGreaterThan(0);
    expect(matchEnds).toBe(1);
    expect(roundEnds).toBeGreaterThanOrEqual(2);
    expect(kills).toBeGreaterThan(3);
    expect(telemetry.reduce((n, t) => n + t.kills, 0)).toBeGreaterThan(3);
    expect(telemetry.reduce((n, t) => n + t.hits, 0)).toBeGreaterThan(0);
  }, 120000);
});
