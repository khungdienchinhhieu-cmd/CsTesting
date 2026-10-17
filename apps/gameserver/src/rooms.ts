import { randomBytes, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { WebSocket } from 'ws';
import { BotSquad } from '@tactical/bots';
import {
  MatchSim, ProtocolCatalog, SimHost, SNAPSHOT_INTERVAL_TICKS, TICK_DT, TICK_RATE,
  buildSnapshot, encodeSnapshot, quantizeInputCommand,
  type BotConfigFile, type GameData, type GameEvent, type GameMap, type InputCommand,
  type MapJson, type NetSnapshot, type PlayerState, type Team,
} from '@tactical/shared';
import type { AuthedUser } from './auth';
import type { ServerMessage, ClientMessage, ServerRosterEntry } from './protocol';
import { playersGauge, rejectedCounter, roomsGauge, snapshotsCounter, ticksCounter, tickLagHistogram } from './metrics';
import type { Logger } from 'pino';

const MAX_TEAM = 5;

export interface RoomCreateOptions {
  mode: 'competitive' | 'quick' | 'deathmatch' | 'custom';
  mapId: string;
  botsPerSide: number;
  tier: string;
  roundsToWin?: number;
  maxRounds?: number;
  privateRoom: boolean;
}

interface ClientConn {
  ws: WebSocket;
  userId: string;
  name: string;
  guest: boolean;
  playerId: number;
  spectator: boolean;
  lastSeq: number;
  lastMessageAt: number;
  windowStart: number;
  windowCount: number;
  lastChatAt: number;
}

interface LoopState {
  timer: NodeJS.Timeout | null;
  last: number;
  acc: number;
  snapshotAcc: number;
  events: GameEvent[];
  lastSnapshot: NetSnapshot | null;
}

/** Một phòng đấu: mô phỏng 64 Hz server-authoritative, snapshot 32 Hz. */
export class Room {
  readonly code: string;
  readonly id: string;
  readonly opts: RoomCreateOptions;
  private readonly data: GameData;
  private readonly maps: Record<string, GameMap>;
  private readonly botConfig: BotConfigFile;
  private readonly log: Logger;
  private sim: MatchSim;
  private host: SimHost | null = null;
  private catalog: ProtocolCatalog;
  private readonly squads = new Map<Team, BotSquad>();
  private readonly clients = new Map<number, ClientConn>();
  private readonly spectators = new Set<ClientConn>();
  private readonly roster = new Map<number, ServerRosterEntry>();
  private readonly seenAt = new Map<number, Map<number, number>>();
  private readonly loop: LoopState = { timer: null, last: 0, acc: 0, snapshotAcc: 0, events: [], lastSnapshot: null };
  private started = false;
  private disposed = false;
  private finished = false;
  private emptySince = 0;
  private botSeq = 100;
  private humanCount = 0;

  constructor(
    code: string, opts: RoomCreateOptions, data: GameData, maps: Record<string, GameMap>,
    botConfig: BotConfigFile, log: Logger,
  ) {
    this.code = code;
    this.id = `room_${code.toLowerCase()}`;
    this.opts = opts;
    this.data = data;
    this.maps = maps;
    this.botConfig = botConfig;
    this.log = log.child({ room: code });
    const map = maps[opts.mapId] ?? maps.sandstorm!;
    this.catalog = new ProtocolCatalog(data);
    const tierCfg = botConfig.tiers[opts.tier] ? opts.tier : 'regular';
    this.opts = { ...opts, tier: tierCfg };
    this.squads.set('T', new BotSquad('T', botConfig, randomInt(1, 1e9)));
    this.squads.set('CT', new BotSquad('CT', botConfig, randomInt(1, 1e9)));
    this.sim = new MatchSim({
      config: {
        mode: opts.mode === 'custom' ? 'custom' : opts.mode,
        mapId: map.json.id,
        roundsToWin: opts.roundsToWin ?? (opts.mode === 'competitive' ? data.gameplay.round.roundsToWin : opts.mode === 'quick' ? 7 : 9),
        maxRounds: opts.maxRounds ?? (opts.mode === 'competitive' ? data.gameplay.round.maxRounds : opts.mode === 'quick' ? 12 : 18),
        freezeTimeSec: opts.mode === 'deathmatch' ? 0.5 : data.gameplay.round.freezeTimeSec,
        roundTimeSec: data.gameplay.round.roundTimeSec,
        warmupSec: 0,
        overtimeEnabled: opts.mode === 'competitive',
        botFill: false,
        infiniteMoney: opts.mode === 'deathmatch',
        friendlyFire: false,
      },
      data, map, seed: randomInt(1, 2 ** 31 - 1),
    });
    roomsGauge.set(0);
  }

  get mapId(): string { return this.opts.mapId; }
  get mode(): string { return this.opts.mode; }
  get isPrivate(): boolean { return this.opts.privateRoom; }
  get activeHumans(): number { return this.humanCount; }
  get isFull(): boolean { return this.clients.size >= MAX_TEAM * 2; }
  get matchFinished(): boolean { return this.finished; }

  private rosterList(): ServerRosterEntry[] {
    return [...this.roster.values()].sort((a, b) => a.id - b.id);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage, exceptWs?: WebSocket): void {
    const raw = JSON.stringify(msg);
    for (const c of this.clients.values()) if (c.ws !== exceptWs && c.ws.readyState === 1) c.ws.send(raw);
    for (const s of this.spectators) if (s.ws !== exceptWs && s.ws.readyState === 1) s.ws.send(raw);
  }

  private teamCount(team: Team): number {
    return this.sim.players.filter((p) => p.connected && p.team === team).length;
  }

  private pickId(): number | null {
    for (let i = 0; i < MAX_TEAM * 2; i++) if (!this.sim.byId.has(i)) return i;
    return null;
  }

  private autoTeam(): Team {
    const t = this.teamCount('T');
    const ct = this.teamCount('CT');
    if (t === ct) return randomInt(0, 2) === 0 ? 'T' : 'CT';
    return t < ct ? 'T' : 'CT';
  }

  private addBot(team: Team): boolean {
    if (this.teamCount(team) >= MAX_TEAM) return false;
    const id = this.pickId();
    if (id === null) return false;
    const name = `BOT ${['Rook', 'Vane', 'Kestrel', 'Mako', 'Iris', 'Talon', 'Cinder', 'Vega', 'Onyx', 'Harbor'][this.botSeq % 10]}`;
    this.botSeq++;
    const p = this.sim.addPlayer({ id, name, team, isBot: true });
    p.money = this.data.economy.startMoney;
    const bot = this.squads.get(team)!.addBot(id, this.opts.tier);
    this.roster.set(id, { id, name, team, bot: true, tier: this.opts.tier, role: bot.role });
    if (this.host) {
      const sq = this.squads.get(team)!;
      this.host.addDriver({ id, name, tier: this.opts.tier, role: bot.role, driver: { think: (v) => sq.think(v) } });
    }
    return true;
  }

  join(ws: WebSocket, user: AuthedUser, hello: Extract<ClientMessage, { t: 'hello' }>): void {
    if (this.disposed) { this.send(ws, { t: 'error', code: 'room_closed', message: 'Phòng đã đóng' }); return; }
    const team: Team = hello.team === 'auto' ? this.autoTeam() : hello.team;
    const wantsSpectate = hello.spectate || this.teamCount(team) >= MAX_TEAM;
    if (wantsSpectate) {
      this.joinSpectator(ws, user);
      return;
    }
    const id = this.pickId();
    if (id === null) { this.joinSpectator(ws, user); return; }
    let p: PlayerState;
    try {
      p = this.sim.addPlayer({ id, name: user.name.slice(0, 16) || 'Operator', team, isBot: false });
    } catch {
      this.joinSpectator(ws, user);
      return;
    }
    p.money = this.opts.mode === 'deathmatch' ? 16000 : this.data.economy.startMoney;
    const conn: ClientConn = {
      ws, userId: user.id, name: p.name, guest: user.guest, playerId: id, spectator: false,
      lastSeq: 0, lastMessageAt: performance.now(), windowStart: performance.now(), windowCount: 0, lastChatAt: 0,
    };
    this.clients.set(id, conn);
    this.roster.set(id, { id, name: p.name, team, bot: false, tier: 'human', role: 'player' });
    this.humanCount++;
    playersGauge.inc();
    this.log.info({ user: user.id, id, team }, 'người chơi vào phòng');
    this.ensureStarted();
    this.send(ws, {
      t: 'welcome', roomId: this.id, code: this.code, youId: id, spectator: false,
      roster: this.rosterList(), mapId: this.opts.mapId, mode: this.opts.mode,
      tick: this.sim.tick, serverTime: Date.now(), tickRate: TICK_RATE,
    });
    this.broadcast({ t: 'roster', roster: this.rosterList() });
  }

  private joinSpectator(ws: WebSocket, user: AuthedUser): void {
    const conn: ClientConn = {
      ws, userId: user.id, name: user.name.slice(0, 16) || 'Spectator', guest: user.guest,
      playerId: -1, spectator: true, lastSeq: 0, lastMessageAt: performance.now(),
      windowStart: performance.now(), windowCount: 0, lastChatAt: 0,
    };
    this.spectators.add(conn);
    this.ensureStarted();
    const first = this.sim.players[0]?.id ?? 0;
    this.send(ws, {
      t: 'welcome', roomId: this.id, code: this.code, youId: first, spectator: true,
      roster: this.rosterList(), mapId: this.opts.mapId, mode: this.opts.mode,
      tick: this.sim.tick, serverTime: Date.now(), tickRate: TICK_RATE,
    });
  }

  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    const bots = Math.max(0, Math.min(MAX_TEAM, this.opts.botsPerSide));
    for (let i = 0; i < bots; i++) { this.addBot('T'); this.addBot('CT'); }
    this.sim.start();
    this.host = new SimHost(this.sim, this.data, this.maps[this.opts.mapId]!, this.botConfig, []);
    for (const [id, r] of this.roster) {
      if (!r.bot) continue;
      const sq = this.squads.get(r.team)!;
      this.host.addDriver({ id, name: r.name, tier: r.tier, role: r.role, driver: { think: (v) => sq.think(v) } });
    }
    this.loop.last = performance.now();
    this.loop.timer = setInterval(() => this.tickLoop(), 4);
    this.log.info({ bots }, 'bắt đầu trận');
  }

  private tickLoop(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dt = now - this.loop.last;
    this.loop.last = now;
    tickLagHistogram.observe(dt);
    this.loop.acc += dt;
    let steps = 0;
    while (this.loop.acc >= TICK_DT * 1000 && steps < 4) {
      this.stepOnce();
      this.loop.acc -= TICK_DT * 1000;
      steps++;
      if (this.finished) break;
    }
    if (steps === 4) this.loop.acc = 0;
    this.loop.snapshotAcc += steps;
    if (this.loop.snapshotAcc >= SNAPSHOT_INTERVAL_TICKS) {
      this.loop.snapshotAcc %= SNAPSHOT_INTERVAL_TICKS;
      this.sendSnapshots();
    }
    if (this.humanCount === 0) {
      if (this.emptySince === 0) this.emptySince = now;
      else if (now - this.emptySince > 30_000) this.dispose();
    } else this.emptySince = 0;
  }

  private stepOnce(): void {
    if (!this.host || this.finished) return;
    const events = this.host.step();
    ticksCounter.inc();
    for (const e of events) {
      this.loop.events.push(e);
      if (e.type === 'kill') this.onKill(e);
      if (e.type === 'match_end' && !this.finished) this.onMatchEnd(e.winner);
    }
    if (this.loop.events.length > 512) this.loop.events.splice(0, this.loop.events.length - 512);
    for (const team of ['T', 'CT'] as const) {
      const sq = this.squads.get(team)!;
      for (const e of events) sq.observeEvent(e);
    }
  }

  private onKill(e: Extract<GameEvent, { type: 'kill' }>): void {
    const attacker = e.attacker === null || e.attacker === undefined ? null : this.sim.byId.get(e.attacker);
    const victim = this.sim.byId.get(e.victim);
    if (!victim) return;
    this.broadcast({
      t: 'kill', attacker: attacker?.name ?? 'WORLD', victim: victim.name, weapon: e.weapon,
      headshot: e.headshot, bot: attacker?.isBot ?? false, tick: e.tick,
    });
  }

  private onMatchEnd(winner: Team): void {
    this.finished = true;
    const r = this.sim.round;
    this.broadcast({ t: 'match_end', winner: winner === 'T' ? 'T' : 'CT', scoreT: r.scoreT, scoreCT: r.scoreCT });
    this.log.info({ winner, scoreT: r.scoreT, scoreCT: r.scoreCT }, 'kết thúc trận');
    setTimeout(() => this.dispose(), 60_000).unref?.();
  }

  handleMessage(ws: WebSocket, msg: ClientMessage): void {
    const conn = this.findConn(ws);
    if (!conn) return;
    const now = performance.now();
    conn.lastMessageAt = now;
    if (now - conn.windowStart > 1000) { conn.windowStart = now; conn.windowCount = 0; }
    conn.windowCount++;
    if (conn.windowCount > 180) {
      rejectedCounter.inc({ reason: 'rate' });
      this.send(ws, { t: 'error', code: 'rate_limited', message: 'Gửi quá nhanh' });
      ws.close(1008, 'rate limit');
      return;
    }
    if (msg.t === 'input') {
      if (conn.spectator || this.finished) return;
      if (msg.seq <= conn.lastSeq) { rejectedCounter.inc({ reason: 'stale_seq' }); return; }
      conn.lastSeq = msg.seq;
      const cmd: InputCommand = quantizeInputCommand({
        seq: msg.seq, tick: this.sim.tick, dt: TICK_DT,
        forward: msg.forward, right: msg.right, yaw: msg.yaw, pitch: msg.pitch,
        buttons: msg.buttons, grenadeSlot: Math.min(4, msg.grenadeSlot),
        viewTick: msg.viewTick,
      });
      this.host?.submitHumanInput(conn.playerId, cmd);
      return;
    }
    if (msg.t === 'buy') {
      if (conn.spectator) return;
      const result = this.sim.buy(conn.playerId, msg.item);
      this.send(ws, { t: 'buy_result', ok: result.ok, itemId: msg.item, reason: result.reason });
      return;
    }
    if (msg.t === 'chat') {
      if (conn.lastChatAt > 0 && now - conn.lastChatAt < 1500) return;
      conn.lastChatAt = now;
      const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
      if (!text) return;
      const p = this.sim.byId.get(conn.playerId);
      const team = p?.team ?? 'T';
      for (const c of this.allConns()) {
        if (msg.teamOnly) {
          const other = c.playerId >= 0 ? this.sim.byId.get(c.playerId) : null;
          if (other?.team !== team && !c.spectator) continue;
        }
        this.send(c.ws, { t: 'chat', from: conn.name, team: msg.teamOnly ? team : 'all', text, bot: false, tick: this.sim.tick });
      }
      return;
    }
    if (msg.t === 'ping') {
      this.send(ws, { t: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
      return;
    }
    if (msg.t === 'leave') { this.leave(ws); return; }
    if (msg.t === 'spectate') { return; }
  }

  private allConns(): ClientConn[] {
    return [...this.clients.values(), ...this.spectators];
  }

  private findConn(ws: WebSocket): ClientConn | undefined {
    for (const c of this.clients.values()) if (c.ws === ws) return c;
    for (const c of this.spectators) if (c.ws === ws) return c;
    return undefined;
  }

  leave(ws: WebSocket): void {
    const conn = this.findConn(ws);
    if (!conn) return;
    this.clients.delete(conn.playerId);
    this.spectators.delete(conn);
    if (!conn.spectator) {
      this.humanCount = Math.max(0, this.humanCount - 1);
      playersGauge.dec();
      this.takeOverWithBot(conn.playerId);
    }
    this.broadcast({ t: 'roster', roster: this.rosterList() });
    this.log.info({ user: conn.userId }, 'rời phòng');
    if (this.clients.size === 0 && this.spectators.size === 0) this.dispose();
  }

  /** Người rời giữa trận được bot thay thế, vẫn gắn nhãn BOT. */
  private takeOverWithBot(playerId: number): void {
    const p = this.sim.byId.get(playerId);
    if (!p || this.finished) return;
    p.isBot = true;
    p.botReplacing = true;
    const sq = this.squads.get(p.team)!;
    const bot = sq.addBot(playerId, this.opts.tier);
    const entry = this.roster.get(playerId);
    if (entry) this.roster.set(playerId, { ...entry, bot: true, tier: this.opts.tier, role: bot.role });
    this.host?.addDriver({ id: playerId, name: p.name, tier: this.opts.tier, role: bot.role, driver: { think: (v) => sq.think(v) } });
  }

  private sendSnapshots(): void {
    if (!this.host) return;
    for (const c of this.clients.values()) {
      const snap = this.snapshotFor(c.playerId, c.lastSeq);
      if (!snap) continue;
      const bytes = encodeSnapshot(snap, null, this.catalog);
      if (c.ws.readyState === 1) {
        const frame = new Uint8Array(bytes.byteLength + 1);
        frame[0] = 1;
        frame.set(bytes, 1);
        c.ws.send(frame, { binary: true });
        snapshotsCounter.inc();
      }
    }
    for (const s of this.spectators) {
      const viewer = this.sim.players[0]?.id ?? 0;
      const snap = this.snapshotFor(viewer, 0, true);
      if (!snap) continue;
      const bytes = encodeSnapshot(snap, null, this.catalog);
      if (s.ws.readyState === 1) {
        const frame = new Uint8Array(bytes.byteLength + 1);
        frame[0] = 1;
        frame.set(bytes, 1);
        s.ws.send(frame, { binary: true });
      }
    }
    this.loop.lastSnapshot = null;
    this.loop.events = [];
  }

  private snapshotFor(selfId: number, ackSeq: number, spectator = false): NetSnapshot | null {
    const self = this.sim.byId.get(selfId);
    if (!self) return null;
    const snap = buildSnapshot(this.sim, selfId, this.catalog, ackSeq, this.filterEventsFor(selfId, spectator));
    snap.players = snap.players.filter((p) => {
      if (spectator || p.id === selfId || p.team === self.team) return true;
      const target = this.sim.byId.get(p.id);
      if (!target) return false;
      return this.canView(self, target);
    });
    return snap;
  }

  /** Lọc theo PVS: không gửi vị trí địch sau tường (chống wallhack phía client). */
  private canView(viewer: PlayerState, target: PlayerState): boolean {
    const dx = target.x - viewer.x;
    const dz = target.z - viewer.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 2.5) return true;
    const fwdX = Math.sin(viewer.yaw);
    const fwdZ = Math.cos(viewer.yaw);
    const dot = (dx * fwdX + dz * fwdZ) / Math.max(0.001, dist);
    const inFov = dot > -0.17; // ~200° để không giật khi quay nhanh
    const eyeY = viewer.y + (viewer.crouching ? 1.16 : 1.64);
    const targetY = target.y + (target.crouching ? 1.0 : 1.5);
    const seen = inFov && this.sim.map.collision.segmentClear(viewer.x, eyeY, viewer.z, target.x, targetY, target.z);
    let map = this.seenAt.get(viewer.id);
    if (!map) { map = new Map(); this.seenAt.set(viewer.id, map); }
    if (seen) map.set(target.id, this.sim.tick);
    const last = map.get(target.id);
    return seen || (last !== undefined && this.sim.tick - last < TICK_RATE * 2);
  }

  private filterEventsFor(selfId: number, spectator: boolean): GameEvent[] {
    if (spectator) return this.loop.events;
    const self = this.sim.byId.get(selfId);
    if (!self) return [];
    const out: GameEvent[] = [];
    for (const e of this.loop.events) {
      const ev = e as GameEvent & { playerId?: number; attacker?: number | null; victim?: number; x?: number; y?: number; z?: number };
      const involved = ev.playerId === selfId || ev.attacker === selfId || ev.victim === selfId;
      switch (e.type) {
        case 'round_start': case 'round_end': case 'round_freeze_end': case 'match_end':
        case 'bomb_planted': case 'bomb_defused': case 'bomb_exploded': case 'bomb_dropped':
        case 'spawn': case 'chat': case 'radio':
          out.push(e); break;
        case 'kill': case 'hit': case 'damage':
          if (involved) out.push(e);
          break;
        default: {
          if (involved) { out.push(e); break; }
          const x = ev.x ?? this.sim.byId.get(ev.playerId ?? -1)?.x;
          const z = ev.z ?? this.sim.byId.get(ev.playerId ?? -1)?.z;
          if (x === undefined || z === undefined) break;
          const d = Math.hypot(x - self.x, z - self.z);
          const audible = e.type === 'footstep' ? 22 : e.type === 'shot' || e.type === 'grenade_throw' ? 55 : 38;
          if (d <= audible) out.push(e);
        }
      }
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.loop.timer) clearInterval(this.loop.timer);
    for (const c of this.allConns()) {
      try { c.ws.close(1001, 'room closed'); } catch { /* ignore */ }
    }
    this.clients.clear();
    this.spectators.clear();
    roomsGauge.dec();
    this.log.info('đóng phòng');
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  constructor(
    private readonly data: GameData,
    private readonly maps: Record<string, GameMap>,
    private readonly botConfig: BotConfigFile,
    private readonly log: Logger,
    private readonly maxRooms = 50,
  ) {}

  list(): { code: string; mode: string; mapId: string; humans: number; private: boolean; started: boolean }[] {
    return [...this.rooms.values()]
      .filter((r) => !r.isPrivate)
      .map((r) => ({ code: r.code, mode: r.mode, mapId: r.mapId, humans: r.activeHumans, private: false, started: true }));
  }

  get(code: string): Room | undefined { return this.rooms.get(code.toUpperCase()); }
  get size(): number { return this.rooms.size; }

  create(opts: RoomCreateOptions): Room {
    if (this.rooms.size >= this.maxRooms) throw new Error('server_full');
    let code = '';
    do { code = randomBytes(3).toString('hex').toUpperCase(); } while (this.rooms.has(code));
    const room = new Room(code, opts, this.data, this.maps, this.botConfig, this.log);
    this.rooms.set(code, room);
    roomsGauge.inc();
    return room;
  }

  findOrCreate(opts: RoomCreateOptions): Room {
    if (!opts.privateRoom) {
      for (const r of this.rooms.values()) {
        if (r.isPrivate || r.isFull || r.matchFinished) continue;
        if (r.mode === opts.mode && r.mapId === opts.mapId) return r;
      }
    }
    return this.create(opts);
  }

  remove(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.dispose();
    this.rooms.delete(code);
  }

  shutdown(): void {
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
    roomsGauge.set(0);
  }
}

/** Ánh xạ JSON map cho các module khác (test). */
export type RoomMapJson = MapJson;
