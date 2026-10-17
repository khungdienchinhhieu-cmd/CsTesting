/// <reference lib="webworker" />
import {
  Buttons, MatchSim, ProtocolCatalog, SimHost, TICK_RATE, buildSnapshot, decodeReplayRow, encodeReplay,
  encodeSnapshot, ReplayRecorder, createReplayMeta, quantizeInputCommand,
  type GameEvent, type InputCommand, type MatchConfig, type Team,
} from '@tactical/shared';
import { BotSquad, type BotSquad as BotSquadType } from '@tactical/bots';
import { loadData } from '../data';
import type { OfflineOptions, RosterEntry, WorkerIn, WorkerOut } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const CALLSIGNS = ['Rook', 'Vane', 'Kestrel', 'Mako', 'Iris', 'Talon', 'Cinder', 'Vega', 'Onyx', 'Harbor'];

let sim: MatchSim | null = null;
let host: SimHost | null = null;
let catalog: ProtocolCatalog | null = null;
let youId = 0;
let roster: RosterEntry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let lastHumanSeq = 0;
let pendingInput: InputCommand | null = null;
let eventAccum: GameEvent[] = [];
const snapshotEvery = 2;
let tickInLoop = 0;
let ended = false;
let paused = false;
let squads: Record<Team, BotSquadType> | null = null;
let recorder: ReplayRecorder | null = null;
let replayQueue: { tick: number; cmd: InputCommand }[] = [];
let replayIndex = 0;
let replayMode = false;

function post(msg: WorkerOut, transfer?: Transferable[]): void {
  ctx.postMessage(msg, transfer ?? []);
}

function buildOptionsVis(mode: OfflineOptions['mode']): { roundsToWin: number; maxRounds: number; freeze: number; roundTime: number; warmup: number } {
  const d = loadData();
  const r = d.data.gameplay.round;
  if (mode === 'quick') return { roundsToWin: 7, maxRounds: 12, freeze: r.freezeTimeSec, roundTime: r.roundTimeSec, warmup: 0 };
  if (mode === 'deathmatch' || mode === 'range') return { roundsToWin: 1, maxRounds: 1, freeze: 0, roundTime: r.roundTimeSec, warmup: 0 };
  return { roundsToWin: r.roundsToWin, maxRounds: r.maxRounds, freeze: r.freezeTimeSec, roundTime: r.roundTimeSec, warmup: r.warmupSec };
}

function init(options: OfflineOptions): void {
  const bundle = loadData();
  replayMode = options.replay !== undefined;
  const replay = options.replay;
  const mapId = replay?.meta.mapId ?? options.mapId;
  const map = bundle.maps[mapId] ?? bundle.maps.sandstorm!;
  const limits = buildOptionsVis(options.mode);
  const config: MatchConfig = replay?.meta.config ?? {
    mode: options.mode === 'quick' ? 'quick' : options.mode,
    mapId: map.json.id,
    freezeTimeSec: options.mode === 'deathmatch' || options.mode === 'range' ? 0 : limits.freeze,
    roundTimeSec: limits.roundTime,
    roundsToWin: options.roundsToWin ?? limits.roundsToWin,
    maxRounds: options.maxRounds ?? limits.maxRounds,
    overtimeEnabled: options.mode === 'competitive',
    botFill: false,
    infiniteMoney: options.infiniteMoney ?? (options.mode === 'range' || options.mode === 'deathmatch'),
    friendlyFire: false,
    warmupSec: options.warmupSec ?? 0,
  };
  const seed = replay?.meta.seed ?? options.seed ?? 1337;
  sim = new MatchSim({ config, data: bundle.data, map, seed });
  catalog = new ProtocolCatalog(bundle.data);
  youId = replay?.meta.youId ?? 0;
  squads = {
    T: new BotSquad('T', bundle.bots, seed + 11),
    CT: new BotSquad('CT', bundle.bots, seed + 29),
  };
  const entries: { id: number; name: string; tier: string; role: string; driver: { think: (v: never) => never } }[] = [];
  const startMoney = bundle.data.economy.startMoney;
  const spawn = (id: number, name: string, team: Team, isBot: boolean, tier?: string, forcedRole?: string): void => {
    const p = sim!.addPlayer({ id, name, team, isBot });
    p.money = options.mode === 'range' ? 16000 : startMoney;
    if (!isBot) return;
    const squad = squads![team];
    const bot = squad.addBot(id, tier ?? options.tier, forcedRole);
    entries.push({ id, name, tier: tier ?? options.tier, role: bot.role, driver: { think: (v) => squad.think(v as never) as never } });
  };
  roster = [];
  if (replay) {
    for (const p of replay.meta.players) {
      spawn(p.id, p.name, p.team, p.isBot, p.tier, p.role);
      roster.push({ id: p.id, name: p.name, team: p.team, bot: p.isBot, tier: p.tier ?? (p.isBot ? 'regular' : 'human'), role: p.role ?? (p.isBot ? 'entry' : 'player') });
    }
    replayQueue = replay.rows.map((row) => decodeReplayRow(row)).sort((a, b) => a.tick - b.tick);
    replayIndex = 0;
    recorder = null;
  } else {
    const me = sim.addPlayer({ id: 0, name: options.name || 'Operator', team: options.team, isBot: false });
    me.money = options.mode === 'range' ? 16000 : startMoney;
    roster.push({ id: 0, name: me.name, team: options.team, bot: false, tier: 'human', role: 'player' });
    const enemyTeam: Team = options.team === 'T' ? 'CT' : 'T';
    let nextId = 1;
    const allyCount = Math.max(0, options.botsPerSide - 1);
    const enemyCount = Math.max(1, options.botsPerSide);
    const spawnBot = (team: Team): void => {
      const id = nextId++;
      const callsign = CALLSIGNS[(id * 3 + (team === 'T' ? 0 : 5)) % CALLSIGNS.length]!;
      const name = `BOT ${callsign}`;
      spawn(id, name, team, true, options.tier);
      roster.push({ id, name, team, bot: true, tier: options.tier, role: entries[entries.length - 1]?.role ?? 'entry' });
    };
    for (let i = 0; i < allyCount; i++) spawnBot(options.team);
    for (let i = 0; i < enemyCount; i++) spawnBot(enemyTeam);
    recorder = options.replay ? null : new ReplayRecorder(createReplayMeta({
      mapId: map.json.id,
      mode: config.mode,
      config,
      seed,
      youId,
      players: roster.map((r) => ({ id: r.id, name: r.name, team: r.team, isBot: r.bot, tier: r.tier, role: r.role })),
    }));
  }
  host = new SimHost(sim, bundle.data, map, bundle.bots, entries);
  sim.start();
  lastHumanSeq = 0; pendingInput = null; eventAccum = []; tickInLoop = 0; ended = false; paused = false;
  post({ type: 'ready', youId, roster, mapId: map.json.id });
  let last = performance.now();
  let acc = 0;
  const stepMs = 1000 / TICK_RATE;
  timer = setInterval(() => {
    const now = performance.now();
    acc += now - last;
    last = now;
    // giới hạn bắt kịp để tránh spiral of death
    if (acc > stepMs * 6) acc = stepMs * 6;
    let steps = 0;
    while (acc >= stepMs && steps < 4) {
      if (!paused) tickOnce();
      acc -= stepMs;
      steps++;
      if (ended) break;
    }
  }, Math.max(2, Math.floor(stepMs / 2)));
}

function feedReplay(): void {
  if (!sim || !host) return;
  while (replayIndex < replayQueue.length) {
    const row = replayQueue[replayIndex]!;
    if (row.tick > sim.tick) break;
    host.submitHumanInput(youId, row.cmd);
    lastHumanSeq = row.cmd.seq;
    replayIndex++;
  }
}

function tickOnce(): void {
  if (!sim || !host || !catalog) return;
  if (replayMode) {
    feedReplay();
  } else if (pendingInput) {
    recorder?.recordInput(sim.tick, pendingInput);
    host.submitHumanInput(youId, pendingInput);
    lastHumanSeq = pendingInput.seq;
    pendingInput = null;
  }
  const events = host.step();
  if (squads) for (const e of events) { squads.T.observeEvent(e); squads.CT.observeEvent(e); }
  if (events.length) eventAccum.push(...events);
  tickInLoop++;
  const matchEnd = events.find((e) => e.type === 'match_end');
  if (matchEnd && !ended) {
    ended = true;
    post({ type: 'match_end', winner: (matchEnd as GameEvent & { winner: Team }).winner });
    if (recorder) {
      const data = recorder.finish(sim.tick);
      post({ type: 'replay', data: encodeReplay(data) });
      recorder = null;
    }
  }
  if (tickInLoop % snapshotEvery === 0) {
    const snap = buildSnapshot(sim, youId, catalog, lastHumanSeq, eventAccum);
    eventAccum = [];
    const bytes = encodeSnapshot(snap, null, catalog);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    post({ type: 'snapshot', tick: snap.tick, buffer: copy.buffer, events: snap.events.length }, [copy.buffer]);
  }
}

ctx.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    if (timer) clearInterval(timer);
    try { init(msg.options); } catch (err) {
      post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
    }
    return;
  }
  if (msg.type === 'input') {
    if (!sim || replayMode) return;
    const cmd = quantizeInputCommand({
      seq: msg.seq, tick: msg.tick, dt: 1 / TICK_RATE,
      forward: msg.forward, right: msg.right, yaw: msg.yaw, pitch: msg.pitch,
      buttons: msg.buttons, grenadeSlot: msg.grenadeSlot, viewTick: msg.tick,
    });
    pendingInput = cmd;
    return;
  }
  if (msg.type === 'pause') { paused = true; return; }
  if (msg.type === 'resume') { paused = false; return; }
  if (msg.type === 'buy') {
    if (!sim || replayMode) return;
    const res = sim.buy(youId, msg.itemId);
    post({ type: 'buy_result', ok: res.ok, itemId: msg.itemId, reason: res.reason });
    return;
  }
};

void Buttons; void TICK_RATE; void encodeSnapshot;
