import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT, readJson } from './lib.ts';

const require = createRequire(import.meta.url);
const shared = require(join(ROOT, 'packages/shared/dist/index.js')) as typeof import('../packages/shared/src/index.ts');
const botPkg = require(join(ROOT, 'packages/bots/dist/index.js')) as typeof import('../packages/bots/src/index.ts');

interface Args { matches: number; tier: string; map: string; mode: string; seconds: number; json: boolean }
function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (name: string, def: string): string => {
    const i = a.indexOf(`--${name}`);
    return i >= 0 && a[i + 1] ? a[i + 1]! : def;
  };
  return {
    matches: Math.max(1, Math.min(50, Number(get('matches', '1')))),
    tier: get('tier', 'regular'),
    map: get('map', 'sandstorm'),
    mode: get('mode', 'quick'),
    seconds: Math.max(10, Math.min(1200, Number(get('seconds', '180')))),
    json: a.includes('--json'),
  };
}

const args = parseArgs();
const data = shared.createGameData(
  readJson('data/weapons.json') as Parameters<typeof shared.createGameData>[0],
  readJson('data/gameplay.json') as Parameters<typeof shared.createGameData>[1],
  readJson('data/economy.json') as Parameters<typeof shared.createGameData>[2],
);
const cfg = readJson('data/bots.json') as never;
const map = new shared.GameMap(readJson(`data/maps/${args.map}.json`) as never);

interface BotRow { id: number; name: string; role: string; kills: number; deaths: number; shots: number; hits: number; headshots: number; damage: number; mistakes: number }
const report: { match: number; ticks: number; ms: number; rounds: number; kills: number; headshots: number; plants: number; defuses: number; shots: number; hits: number; scoreT: number; scoreCT: number; bots: BotRow[] }[] = [];

for (let m = 0; m < args.matches; m++) {
  const sim = new shared.MatchSim({
    config: {
      mode: args.mode === 'competitive' ? 'competitive' : 'quick', mapId: args.map,
      roundsToWin: args.mode === 'competitive' ? 13 : 7, maxRounds: args.mode === 'competitive' ? 24 : 12,
      freezeTimeSec: 5, roundTimeSec: data.gameplay.round.roundTimeSec, overtimeEnabled: false,
      botFill: false, infiniteMoney: false, friendlyFire: false, warmupSec: 0,
    },
    data, map, seed: 7000 + m,
  });
  const squads = { T: new botPkg.BotSquad('T', cfg, 100 + m), CT: new botPkg.BotSquad('CT', cfg, 900 + m) };
  const entries: { id: number; name: string; tier: string; role: string; driver: { think: (v: never) => never } }[] = [];
  for (let i = 0; i < 10; i++) {
    const team = i < 5 ? 'T' : 'CT';
    const name = `BOT ${team}${i}`;
    sim.addPlayer({ id: i, name, team, isBot: true });
    const bot = (team === 'T' ? squads.T : squads.CT).addBot(i, args.tier);
    entries.push({ id: i, name, tier: args.tier, role: bot.role, driver: { think: (v) => (team === 'T' ? squads.T : squads.CT).think(v as never) as never } });
  }
  const host = new shared.SimHost(sim, data, map, cfg, entries);
  sim.start();
  const stats = new Map<number, BotRow>();
  for (const e of entries) stats.set(e.id, { id: e.id, name: e.name, role: e.role, kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, damage: 0, mistakes: 0 });
  let rounds = 0, plants = 0, defuses = 0, matchEnded = false;
  const t0 = performance.now();
  const maxTicks = args.seconds * shared.TICK_RATE;
  for (let t = 0; t < maxTicks && !matchEnded; t++) {
    const events = host.step();
    for (const e of events) {
      squads.T.observeEvent(e); squads.CT.observeEvent(e);
      if (e.type === 'shot') { const s = stats.get(e.playerId); if (s) s.shots++; }
      if (e.type === 'hit') { const s = stats.get(e.attacker); if (s) { s.hits++; s.damage += e.damage; } }
      if (e.type === 'kill') {
        const a = stats.get(e.attacker ?? -1); if (a) { a.kills++; if (e.headshot) a.headshots++; }
        const v = stats.get(e.victim); if (v) v.deaths++;
      }
      if (e.type === 'round_end') rounds++;
      if (e.type === 'bomb_planted') plants++;
      if (e.type === 'bomb_defused') defuses++;
      if (e.type === 'match_end') matchEnded = true;
    }
  }
  const ms = performance.now() - t0;
  for (const [id, row] of stats) {
    const tele = (id < 5 ? squads.T : squads.CT).telemetry().find((x) => x.id === id);
    if (tele) row.mistakes = tele.mistakes.length;
  }
  report.push({
    match: m + 1, ticks: sim.tick, ms: Math.round(ms), rounds,
    kills: [...stats.values()].reduce((n, s) => n + s.kills, 0),
    headshots: [...stats.values()].reduce((n, s) => n + s.headshots, 0),
    plants, defuses,
    shots: [...stats.values()].reduce((n, s) => n + s.shots, 0),
    hits: [...stats.values()].reduce((n, s) => n + s.hits, 0),
    scoreT: sim.round.scoreT, scoreCT: sim.round.scoreCT,
    bots: [...stats.values()].sort((a, b) => b.kills - a.kills),
  });
}

if (args.json) {
  console.log(JSON.stringify({ args, report }, null, 2));
} else {
  console.log(`\nBOT-SIM · ${args.tier} · ${args.map} · ${args.mode} · ${args.matches} trận`);
  for (const r of report) {
    const acc = r.shots > 0 ? ((r.hits / r.shots) * 100).toFixed(1) : '—';
    console.log(`\nTrận ${r.match}: ${r.rounds} vòng · T ${r.scoreT}-${r.scoreCT} CT · ${r.kills} kill (${r.headshots} HS) · plant ${r.plants} · defuse ${r.defuses}`);
    console.log(`  ${r.shots} phát bắn, ${r.hits} trúng (${acc}%) · ${r.ticks} tick / ${r.ms}ms`);
    for (const b of r.bots) console.log(`  #${b.id.toString().padStart(2)} ${b.name.padEnd(12)} ${b.role.padEnd(8)} ${b.kills}/${b.deaths}  ${b.hits}/${b.shots}  dmg ${b.damage}  lỗi ${b.mistakes}`);
  }
}
