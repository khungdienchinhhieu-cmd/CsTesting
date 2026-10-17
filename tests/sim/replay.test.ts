import { describe, expect, it } from 'vitest';
import {
  Buttons, MatchSim, SimHost, TICK_RATE, ReplayRecorder, createReplayMeta, quantizeInputCommand,
  type BotConfigFile, type MatchConfig, type ReplayMeta, type Team,
} from '@tactical/shared';
import { BotSquad } from '@tactical/bots';
import { testBots, testData, testMap } from '../helpers';

const config: MatchConfig = {
  mode: 'quick', mapId: 'sandstorm', roundsToWin: 2, maxRounds: 4, freezeTimeSec: 1,
  roundTimeSec: 30, overtimeEnabled: false, botFill: false, infiniteMoney: false,
  friendlyFire: false, warmupSec: 0,
};
const seed = 4242;
const players = [
  { id: 0, name: 'Operator', team: 'T' as Team, isBot: false },
  { id: 1, name: 'BOT Rook', team: 'T' as Team, isBot: true, tier: 'pro', role: 'entry' },
  { id: 2, name: 'BOT Vane', team: 'CT' as Team, isBot: true, tier: 'veteran', role: 'anchor' },
  { id: 3, name: 'BOT Kestrel', team: 'CT' as Team, isBot: true, tier: 'regular', role: 'support' },
];

function buildMatch(meta?: ReplayMeta): { sim: MatchSim; host: SimHost; squads: Record<Team, BotSquad> } {
  const data = testData();
  const map = testMap();
  const bots = testBots() as BotConfigFile;
  const sim = new MatchSim({ config: meta?.config ?? config, data, map, seed: meta?.seed ?? seed });
  const s = meta?.seed ?? seed;
  const squads: Record<Team, BotSquad> = { T: new BotSquad('T', bots, s + 11), CT: new BotSquad('CT', bots, s + 29) };
  const entries: { id: number; name: string; tier: string; role: string; driver: { think: (v: never) => never } }[] = [];
  for (const p of meta?.players ?? players) {
    sim.addPlayer({ id: p.id, name: p.name, team: p.team, isBot: p.isBot });
    if (!p.isBot) continue;
    const bot = squads[p.team].addBot(p.id, p.tier ?? 'regular', p.role);
    entries.push({ id: p.id, name: p.name, tier: p.tier ?? 'regular', role: bot.role, driver: { think: (v) => squads[p.team].think(v as never) as never } });
  }
  const host = new SimHost(sim, data, map, bots, entries);
  sim.start();
  return { sim, host, squads };
}

function stateFingerprint(sim: MatchSim): string {
  const round = `${sim.round.phase}/${sim.round.scoreT}:${sim.round.scoreCT}/${sim.round.roundNumber}`;
  const ps = sim.players.map((p) => `${p.id}:${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)},${p.health.toFixed(2)},${p.alive ? 1 : 0},${p.money}`).join('|');
  return `${sim.tick} ${round} ${ps}`;
}

describe('replay tất định', () => {
  it('chạy lại từ seed + input cho cùng trạng thái', () => {
    const first = buildMatch();
    const meta = createReplayMeta({
      mapId: 'sandstorm', mode: 'quick', config, seed, youId: 0,
      players: players.map((p) => ({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, tier: 'tier' in p ? p.tier : undefined, role: 'role' in p ? p.role : undefined })),
    });
    const rec = new ReplayRecorder(meta);
    let endTick = 0;
    for (let i = 0; i < 600; i++) {
      const cmd = quantizeInputCommand({
        seq: i + 1, tick: first.sim.tick, dt: 1 / TICK_RATE,
        forward: Math.sin(i / 45), right: Math.cos(i / 70),
        yaw: (i / 90) % (Math.PI * 2), pitch: 0,
        buttons: i % 64 === 0 ? Buttons.Primary : 0, grenadeSlot: 0,
      });
      rec.recordInput(first.sim.tick, cmd);
      first.host.submitHumanInput(0, cmd);
      const events = first.host.step();
      for (const e of events) { first.squads.T.observeEvent(e as never); first.squads.CT.observeEvent(e as never); }
      endTick = first.sim.tick;
      if (events.some((e) => e.type === 'match_end')) break;
    }
    const before = stateFingerprint(first.sim);
    const replay = rec.finish(endTick);

    const second = buildMatch(replay.meta);
    let idx = 0;
    for (let i = 0; i < endTick; i++) {
      while (idx < replay.rows.length) {
        const row = replay.rows[idx]!;
        const at = row[0]!;
        if (at > second.sim.tick) break;
        second.host.submitHumanInput(0, {
          seq: row[1]!, tick: at, dt: 1 / TICK_RATE,
          forward: row[2]! / 1000, right: row[3]! / 1000,
          yaw: row[4]! / 100_000, pitch: row[5]! / 100_000,
          buttons: row[6]!, grenadeSlot: row[7]!,
        });
        idx++;
      }
      second.host.step();
    }
    const after = stateFingerprint(second.sim);
    expect(after).toBe(before);
    expect(idx).toBe(replay.rows.length);
  }, 120000);
});
