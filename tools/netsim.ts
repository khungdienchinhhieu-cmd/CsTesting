import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT, readJson } from './lib.ts';
const require = createRequire(import.meta.url);
const shared = require(join(ROOT, 'packages/shared/dist/index.js')) as typeof import('../packages/shared/src/index.ts');
const bots = require(join(ROOT, 'packages/bots/dist/index.js')) as typeof import('../packages/bots/src/index.ts');
const arg = (name: string, def: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const seconds = Math.max(2, Math.min(300, Number(arg('seconds', '20'))));
const loss = Math.max(0, Math.min(0.5, Number(arg('loss', '0.02'))));
const data = shared.createGameData(readJson('data/weapons.json') as never, readJson('data/gameplay.json') as never, readJson('data/economy.json') as never);
const cfg = readJson('data/bots.json') as never;
const map = new shared.GameMap(readJson('data/maps/sandstorm.json') as never);
const sim = new shared.MatchSim({ config: { mode: 'quick', mapId: 'sandstorm', roundsToWin: 7, maxRounds: 12, freezeTimeSec: 2, roundTimeSec: 115, overtimeEnabled: false, botFill: false, infiniteMoney: false, friendlyFire: false, warmupSec: 0 }, data, map, seed: 42 });
const sT = new bots.BotSquad('T', cfg, 1); const sCT = new bots.BotSquad('CT', cfg, 2);
const entries: { id: number; name: string; tier: string; role: string; driver: { think: (v: never) => never } }[] = [];
for (let i = 0; i < 10; i++) {
  const team = i < 5 ? 'T' : 'CT'; sim.addPlayer({ id: i, name: `BOT ${i}`, team, isBot: true });
  const b = (team === 'T' ? sT : sCT).addBot(i, 'regular');
  entries.push({ id: i, name: `BOT ${i}`, tier: 'regular', role: b.role, driver: { think: (v) => (team === 'T' ? sT : sCT).think(v as never) as never } });
}
const host = new shared.SimHost(sim, data, map, cfg, entries);
const catalog = new shared.ProtocolCatalog(data);
sim.start();
let bytes = 0, sent = 0, dropped = 0, errors = 0, events = 0;
const sizes: number[] = [];
const decodeTimes: number[] = [];
const ticks = seconds * shared.TICK_RATE;
for (let t = 0; t < ticks; t++) {
  const ev = host.step();
  events += ev.length;
  if (t % shared.SNAPSHOT_INTERVAL_TICKS !== 0) continue;
  if (Math.random() < loss) { dropped++; continue; }
  const snap = shared.buildSnapshot(sim, 0, catalog, t, ev);
  const encodeStart = performance.now();
  const buf = shared.encodeSnapshot(snap, null, catalog);
  const encodeMs = performance.now() - encodeStart;
  bytes += buf.byteLength; sent++; sizes.push(buf.byteLength);
  const d0 = performance.now();
  try {
    const decoded = shared.decodeSnapshot(buf, null, catalog);
    if (decoded.players.length !== snap.players.length) errors++;
  } catch { errors++; }
  decodeTimes.push(performance.now() - d0 + encodeMs);
}
sizes.sort((a, b) => a - b); decodeTimes.sort((a, b) => a - b);
const kbps = (bytes * 8) / 1000 / seconds;
console.log(`NETSIM · ${seconds}s · loss ${(loss * 100).toFixed(1)}% · ${sent} snapshot gửi, ${dropped} mất`);
console.log(`  băng thông ${kbps.toFixed(1)} kbps (${(bytes / sent).toFixed(0)} B/snapshot, p95 ${sizes[Math.floor(sizes.length * 0.95)] ?? 0} B)`);
console.log(`  encode+decode p50 ${(decodeTimes[Math.floor(decodeTimes.length * 0.5)] ?? 0).toFixed(3)}ms · p99 ${(decodeTimes[Math.floor(decodeTimes.length * 0.99)] ?? 0).toFixed(3)}ms`);
console.log(`  lỗi giải mã ${errors} · ${events} sự kiện`);
if (errors > 0) process.exit(1);
