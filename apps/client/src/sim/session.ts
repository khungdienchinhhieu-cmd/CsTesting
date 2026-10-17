import type { NetSnapshot, Team } from '@tactical/shared';
import type { OfflineOptions, WorkerIn, WorkerOut } from './protocol';
import type { ClientSession, ReadyInfo } from './client-session';

export type { ReadyInfo };

/** Cầu nối tới listen-server chạy trong Web Worker (offline). */
export class OfflineSession implements ClientSession {
  private worker: Worker | null = null;
  private readyResolve: ((v: ReadyInfo) => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  ready: Promise<ReadyInfo> = new Promise<ReadyInfo>(() => { /* chờ start() */ });
  onSnapshot?: (snap: NetSnapshot, tick: number) => void;
  onError?: (message: string) => void;
  onMatchEnd?: (winner: Team) => void;
  onBuyResult?: (ok: boolean, itemId: string, reason?: string) => void;
  onReplay?: (json: string) => void;
  latestTick = 0;
  latencyMs = 0;

  start(options: OfflineOptions, decode: (buf: ArrayBuffer) => NetSnapshot): Promise<ReadyInfo> {
    this.destroy();
    this.ready = new Promise<ReadyInfo>((res, rej) => { this.readyResolve = res; this.readyReject = rej; });
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'listen-server' });
    this.worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const msg = ev.data;
      if (msg.type === 'ready') {
        this.readyResolve?.({ youId: msg.youId, roster: msg.roster, mapId: msg.mapId });
        return;
      }
      if (msg.type === 'snapshot') {
        try {
          const snap = decode(msg.buffer);
          this.latestTick = Math.max(this.latestTick, snap.tick);
          this.onSnapshot?.(snap, msg.tick);
        } catch (err) {
          this.onError?.(`Giải mã snapshot lỗi: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      if (msg.type === 'buy_result') { this.onBuyResult?.(msg.ok, msg.itemId, msg.reason); return; }
      if (msg.type === 'error') { this.onError?.(msg.message); this.readyReject?.(new Error(msg.message)); return; }
      if (msg.type === 'match_end') { this.onMatchEnd?.(msg.winner); return; }
      if (msg.type === 'replay') { this.onReplay?.(msg.data); return; }
    };
    this.worker.onerror = (e) => {
      this.onError?.(`Worker lỗi: ${e.message}`);
      this.readyReject?.(new Error(e.message));
    };
    const init: WorkerIn = { type: 'init', options };
    this.worker.postMessage(init);
    return this.ready;
  }

  sendInput(input: Omit<Extract<WorkerIn, { type: 'input' }>, 'type'>): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'input', ...input } satisfies WorkerIn);
  }

  pause(): void { this.worker?.postMessage({ type: 'pause' } satisfies WorkerIn); }
  setSpeed(speed: number): void { this.worker?.postMessage({ type: 'speed', speed } satisfies WorkerIn); }
  resume(): void { this.worker?.postMessage({ type: 'resume' } satisfies WorkerIn); }
  chat(text: string, _teamOnly = false): void { this.worker?.postMessage({ type: 'chat', text } satisfies WorkerIn); }

  buy(itemId: string): void {
    this.worker?.postMessage({ type: 'buy', itemId } satisfies WorkerIn);
  }

  destroy(): void {
    if (this.worker) { this.worker.postMessage({ type: 'quit' } satisfies WorkerIn); this.worker.terminate(); this.worker = null; }
    this.readyResolve = null; this.readyReject = null;
    this.latestTick = 0;
  }
}
