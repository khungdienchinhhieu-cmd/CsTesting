import type { NetSnapshot, Team } from '@tactical/shared';
import type { OfflineOptions, RosterEntry } from './protocol';

export interface ReadyInfo {
  youId: number;
  roster: RosterEntry[];
  mapId: string;
}

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Giao diện chung cho listen-server offline (Web Worker) và máy chủ online (WebSocket).
 * GameView chỉ phụ thuộc vào giao diện này để cùng một luồng chơi dùng cho cả hai chế độ.
 */
export interface ClientSession {
  ready: Promise<ReadyInfo>;
  latestTick: number;
  latencyMs: number;
  readonly online?: boolean;
  onSnapshot?: (snap: NetSnapshot, tick: number) => void;
  onError?: (message: string) => void;
  onMatchEnd?: (winner: Team) => void;
  onBuyResult?: (ok: boolean, itemId: string, reason?: string) => void;
  onChat?: (from: string, text: string, team: 'T' | 'CT' | 'all', bot: boolean) => void;
  onRoster?: (roster: RosterEntry[]) => void;
  onReady?: (info: ReadyInfo) => void;
  onState?: (state: ConnectionState, detail?: string) => void;
  onReplay?: (json: string) => void;
  start(options: OfflineOptions, decode: (buf: ArrayBuffer) => NetSnapshot): Promise<ReadyInfo>;
  sendInput(input: Omit<{ seq: number; tick: number; forward: number; right: number; yaw: number; pitch: number; buttons: number; grenadeSlot: number }, 'type'>): void;
  buy(itemId: string): void;
  chat(text: string, teamOnly?: boolean): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}
