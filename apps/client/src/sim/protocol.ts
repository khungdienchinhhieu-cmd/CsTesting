import type { GameMap, NetSnapshot, ReplayData, Team } from '@tactical/shared';

export type GameMode = 'competitive' | 'quick' | 'deathmatch' | 'range';

export interface OfflineOptions {
  name: string;
  mode: GameMode;
  mapId: string;
  team: Team;
  botsPerSide: number;
  tier: string;
  seed?: number;
  roundsToWin?: number;
  maxRounds?: number;
  warmupSec?: number;
  infiniteMoney?: boolean;
  /** Chế độ online: địa chỉ WebSocket của gameserver. */
  url?: string;
  roomCode?: string;
  token?: string;
  spectate?: boolean;
  /** Phát lại trận đã ghi (bỏ qua input trực tiếp). */
  replay?: ReplayData;
}

export interface RosterEntry {
  id: number;
  name: string;
  team: Team;
  bot: boolean;
  tier: string;
  role: string;
}

export type WorkerIn =
  | { type: 'init'; options: OfflineOptions }
  | { type: 'input'; seq: number; tick: number; forward: number; right: number; yaw: number; pitch: number; buttons: number; grenadeSlot: number }
  | { type: 'buy'; itemId: string }
  | { type: 'chat'; text: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'quit' };

export type WorkerOut =
  | { type: 'ready'; youId: number; roster: RosterEntry[]; mapId: string }
  | { type: 'snapshot'; tick: number; buffer: ArrayBuffer; events: number }
  | { type: 'buy_result'; ok: boolean; itemId: string; reason?: string }
  | { type: 'error'; message: string }
  | { type: 'match_end'; winner: Team }
  | { type: 'replay'; data: string };

export interface SnapshotEnvelope {
  tick: number;
  snap: NetSnapshot;
}

export type ClientMap = GameMap;
