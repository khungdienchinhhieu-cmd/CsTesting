import { TICK_RATE } from './constants';
import type { InputCommand, MatchConfig, PlayerId, Team } from './types';

/** Phiên bản định dạng replay. Tăng khi thay đổi cấu trúc để từ chối file cũ an toàn. */
export const REPLAY_VERSION = 1;

export interface ReplayPlayerMeta {
  id: PlayerId;
  name: string;
  team: Team;
  isBot: boolean;
  tier?: string;
  role?: string;
}

export interface ReplayMeta {
  v: typeof REPLAY_VERSION;
  createdAt: number;
  mapId: string;
  mode: MatchConfig['mode'];
  config: MatchConfig;
  seed: number;
  youId: PlayerId;
  tickRate: number;
  endTick: number;
  players: ReplayPlayerMeta[];
}

/**
 * Replay chỉ lưu input của người chơi + seed + cấu hình.
 * Bot được tái mô phỏng tất định từ seed, không cần lưu từng quyết định.
 * Mỗi dòng: [tick, playerId, seq, forward, right, yaw, pitch, buttons, grenadeSlot]
 */
export interface ReplayData {
  meta: ReplayMeta;
  rows: number[][];
}

const MAX_ROWS = 500_000;
const MAX_PLAYERS = 10;

/** Lượng tử hoá input để bản ghi và mô phỏng dùng đúng cùng một giá trị. */
export function quantizeInputCommand(cmd: InputCommand): InputCommand {
  return {
    seq: cmd.seq | 0,
    tick: cmd.tick | 0,
    dt: cmd.dt,
    forward: Math.round(Math.max(-1, Math.min(1, cmd.forward)) * 1000) / 1000,
    right: Math.round(Math.max(-1, Math.min(1, cmd.right)) * 1000) / 1000,
    yaw: Math.round(cmd.yaw * 100_000) / 100_000,
    pitch: Math.round(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cmd.pitch)) * 100_000) / 100_000,
    buttons: cmd.buttons | 0,
    grenadeSlot: cmd.grenadeSlot | 0,
  };
}

export function createReplayMeta(input: Omit<ReplayMeta, 'v' | 'tickRate' | 'endTick' | 'createdAt'> & { createdAt?: number }): ReplayMeta {
  return {
    v: REPLAY_VERSION,
    createdAt: input.createdAt ?? Date.now(),
    mapId: input.mapId,
    mode: input.mode,
    config: input.config,
    seed: input.seed,
    youId: input.youId,
    tickRate: TICK_RATE,
    endTick: 0,
    players: input.players.slice(0, MAX_PLAYERS),
  };
}

export class ReplayRecorder {
  private readonly meta: ReplayMeta;
  private readonly rows: number[][] = [];

  constructor(meta: ReplayMeta) {
    this.meta = { ...meta, players: meta.players.slice(0, MAX_PLAYERS) };
  }

  recordInput(tick: number, cmd: InputCommand): void {
    if (!Number.isFinite(tick) || tick < 0) return;
    this.rows.push([
      tick | 0,
      cmd.seq | 0,
      Math.round(cmd.forward * 1000),
      Math.round(cmd.right * 1000),
      Math.round(cmd.yaw * 100_000),
      Math.round(cmd.pitch * 100_000),
      cmd.buttons | 0,
      cmd.grenadeSlot | 0,
    ]);
    if (this.rows.length > MAX_ROWS) this.rows.splice(0, this.rows.length - MAX_ROWS);
  }

  get size(): number { return this.rows.length; }

  finish(endTick: number): ReplayData {
    this.meta.endTick = Math.max(0, endTick | 0);
    return { meta: { ...this.meta, players: this.meta.players.map((p) => ({ ...p })) }, rows: this.rows.map((r) => r.slice()) };
  }
}

/** Ghi input theo tick; playerId không lưu vì replay hiện hỗ trợ 1 người điều khiển. */
export function decodeReplayRow(row: number[]): { tick: number; cmd: InputCommand } {
  if (row.length !== 8) throw new Error('[replay] dòng input sai độ dài');
  const [tick, seq, fwd, right, yaw, pitch, buttons, grenadeSlot] = row as [number, number, number, number, number, number, number, number];
  for (const n of row) if (!Number.isFinite(n)) throw new Error('[replay] dòng input không hợp lệ');
  return {
    tick: Math.max(0, tick | 0),
    cmd: {
      seq: seq | 0,
      tick: tick | 0,
      dt: 1 / TICK_RATE,
      forward: Math.max(-1, Math.min(1, fwd / 1000)),
      right: Math.max(-1, Math.min(1, right / 1000)),
      yaw: yaw / 100_000,
      pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch / 100_000)),
      buttons: buttons | 0,
      grenadeSlot: grenadeSlot | 0,
    },
  };
}

export function encodeReplay(data: ReplayData): string {
  return JSON.stringify({ meta: data.meta, rows: data.rows });
}

export function decodeReplay(json: string): ReplayData {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('[replay] JSON không hợp lệ'); }
  if (typeof raw !== 'object' || raw === null) throw new Error('[replay] dữ liệu rỗng');
  const obj = raw as { meta?: unknown; rows?: unknown };
  const meta = obj.meta as Partial<ReplayMeta> | undefined;
  if (!meta || meta.v !== REPLAY_VERSION) throw new Error('[replay] phiên bản không hỗ trợ');
  if (typeof meta.mapId !== 'string' || !Array.isArray(meta.players) || meta.players.length === 0) throw new Error('[replay] thiếu thông tin trận');
  if (!Array.isArray(obj.rows) || obj.rows.length > MAX_ROWS) throw new Error('[replay] số dòng input vượt giới hạn');
  const rows = (obj.rows as unknown[]).map((row) => {
    if (!Array.isArray(row) || row.length !== 8) throw new Error('[replay] dòng input sai định dạng');
    return (row as unknown[]).map((n) => {
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('[replay] dòng input chứa giá trị lạ');
      return n;
    });
  });
  const players = (meta.players as ReplayPlayerMeta[]).map((p) => {
    if (typeof p.id !== 'number' || typeof p.name !== 'string' || (p.team !== 'T' && p.team !== 'CT')) throw new Error('[replay] người chơi không hợp lệ');
    return { id: p.id, name: p.name.slice(0, 16), team: p.team, isBot: p.isBot === true, tier: p.tier, role: p.role };
  });
  return {
    meta: {
      v: REPLAY_VERSION,
      createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
      mapId: meta.mapId,
      mode: (meta.mode ?? 'custom') as MatchConfig['mode'],
      config: meta.config as MatchConfig,
      seed: typeof meta.seed === 'number' ? meta.seed : 1,
      youId: typeof meta.youId === 'number' ? meta.youId : players[0]!.id,
      tickRate: meta.tickRate === TICK_RATE ? TICK_RATE : TICK_RATE,
      endTick: typeof meta.endTick === 'number' ? meta.endTick : 0,
      players,
    },
    rows,
  };
}
