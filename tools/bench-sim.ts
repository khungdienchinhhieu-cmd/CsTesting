import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT, readJson } from './lib.ts';
const require = createRequire(import.meta.url);
const shared = require(join(ROOT, 'packages/shared/dist/index.js')) as typeof import('../packages/shared/src/index.ts');
const bots = require(join(ROOT, 'packages/bots/dist/index.js')) as typeof import('../packages/bots/src/index.ts');
const seconds = Math.max(1, Math.min(120, Number(process.argv.find((a) => a.startsWith('--seconds='))?.split('=')[1] ?? '10')));
const data = shared.createGameData(readJson('data/weapons.json') as never, readJson('data/gameplay.json') as never, readJson('data/economy.json') as never);
const cfg = readJson('data/bots.json') as never;
const map = new shared.GameMap(readJson('data/maps/sandstorm.json') as never);
const sim = new shared.MatchSim({ config: { mode: 'quick', mapId: 'sandstorm', roundsToWin: 7, maxRounds: 12, freezeTimeSec: 5, roundTimeSec: 115, overtimeEnabled: false, botFill: false, infiniteMoney: false, friendlyFire: false, warmupSec: 0 }, data, map, seed: 99 });
const sT = new bots.BotSquad('T', cfg, 1); const sCT = new bots.BotSquad('CT', cfg, 2);
const entries: { id: number; name: string; tier: string; role: string; driver: { think: (v: never) => never } }[] = [];
for (let i = 0; i < 10; i++) {
  const team = i < 5 ? 'T' : 'CT'; sim.addPlayer({ id: i, name: `BOT ${i}`, team, isBot: true });
  const b = (team === 'T' ? sT : sCT).addBot(i, 'pro');
  entries.push({ id: i, name: `BOT ${i}`, tier: 'pro', role: b.role, driver: { think: (v) => (team === 'T' ? sT : sCT).think(v as never) as never } });
}
const host = new shared.SimHost(sim, data, map, cfg, entries);
sim.start();
const ticks = seconds * shared.TICK_RATE;
const samples: number[] = [];
let events = 0;
const start = performance.now();
for (let i = 0; i < ticks; i++) {
  const t0 = performance.now();
  events += host.step().length;
  samples.push(performance.now() - t0);
}
const total = performance.now() - start;
samples.sort((a, b) => a - b);
const pct = (p: number): number => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] ?? 0;
const avg = total / ticks;
const budget = 1000 / shared.TICK_RATE;
const mem = process.memoryUsage();
console.log(`BENCH-SIM · ${seconds}s · ${ticks} tick · 10 bot pro`);
console.log(`  tổng ${total.toFixed(1)}ms · trung bình ${avg.toFixed(3)}ms/tick · p50 ${pct(0.5).toFixed(3)} · p95 ${pct(0.95).toFixed(3)} · p99 ${pct(0.99).toFixed(3)} · max ${(samples.at(-1) ?? 0).toFixed(3)}`);
console.log(`  ngân sách tick ${budget.toFixed(3)}ms → dùng ${((avg / budget) * 100).toFixed(1)}% · ${events} sự kiện`);
console.log(`  RSS ${(mem.rss / 1024 / 1024).toFixed(1)}MB · heapUsed ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`);
process.exit(avg > budget ? 2 : 0);
