import type { NetSnapshot, Team } from '@tactical/shared';
import type { ClientSession, ConnectionState, ReadyInfo } from './client-session';
import type { OfflineOptions, RosterEntry } from './protocol';

interface ServerRosterEntry { id: number; name: string; team: 'T' | 'CT'; bot: boolean; tier: string; role: string }

type ServerMsg =
  | { t: 'welcome'; roomId: string; code: string; youId: number; spectator: boolean; roster: ServerRosterEntry[]; mapId: string; mode: string; tick: number; serverTime: number; tickRate: number }
  | { t: 'roster'; roster: ServerRosterEntry[] }
  | { t: 'buy_result'; ok: boolean; itemId: string; reason?: string }
  | { t: 'chat'; from: string; team: 'T' | 'CT' | 'all'; text: string; bot: boolean; tick: number }
  | { t: 'kill'; attacker: string; victim: string; weapon: string; headshot: boolean; bot: boolean; tick: number }
  | { t: 'match_end'; winner: 'T' | 'CT' | 'draw'; scoreT: number; scoreCT: number }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'error'; code: string; message: string };

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 8000];

/** URL WebSocket mặc định: cùng origin, Vite proxy (dev) hoặc nginx (prod) chuyển tiếp tới gameserver. */
export function resolveOnlineUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromEnv = env?.VITE_WS_URL;
  if (fromEnv) return fromEnv;
  // GitHub Pages không có backend: để trống để người dùng nhập wss:// của server riêng.
  if (location.hostname.endsWith('github.io')) return '';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/**
 * Phiên chơi online: hello/welcome, snapshot nhị phân, ping RTT, tự kết nối lại
 * và giữ nguyên mã phòng để tham gia lại phòng cũ trong thời gian chờ.
 */
export class OnlineSession implements ClientSession {
  ready: Promise<ReadyInfo> = new Promise<ReadyInfo>(() => { /* chờ start() */ });
  onSnapshot?: (snap: NetSnapshot, tick: number) => void;
  onError?: (message: string) => void;
  onMatchEnd?: (winner: Team) => void;
  onBuyResult?: (ok: boolean, itemId: string, reason?: string) => void;
  onChat?: (from: string, text: string, team: 'T' | 'CT' | 'all', bot: boolean) => void;
  onRoster?: (roster: RosterEntry[]) => void;
  onReady?: (info: ReadyInfo) => void;
  onState?: (state: ConnectionState, detail?: string) => void;
  latestTick = 0;
  latencyMs = 0;
  roomCode = '';
  readonly online = true;

  private ws: WebSocket | null = null;
  private options: (OfflineOptions & { url: string }) | null = null;
  private decode: ((buf: ArrayBuffer) => NetSnapshot) | null = null;
  private readyResolve: ((v: ReadyInfo) => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private destroyed = false;
  private welcomed = false;
  private finished = false;
  private attempt = 0;
  private reconnectTimer = 0;
  private pingTimer = 0;
  private pingSentAt = 0;

  start(options: OfflineOptions, decode: (buf: ArrayBuffer) => NetSnapshot): Promise<ReadyInfo> {
    this.destroy();
    this.destroyed = false;
    this.finished = false;
    this.welcomed = false;
    this.attempt = 0;
    this.latestTick = 0;
    this.latencyMs = 0;
    if (!options.url) throw new Error('Thiếu địa chỉ máy chủ online');
    this.decode = decode;
    this.options = options as OfflineOptions & { url: string };
    this.ready = new Promise<ReadyInfo>((res, rej) => { this.readyResolve = res; this.readyReject = rej; });
    this.open();
    return this.ready;
  }

  private open(): void {
    const opts = this.options;
    if (!opts || this.destroyed) return;
    this.onState?.(this.welcomed ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(opts.url);
    } catch {
      this.fail('URL máy chủ không hợp lệ');
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.onState?.('open');
      this.attempt = 0;
      this.send({
        t: 'hello', token: opts.token, name: opts.name, mode: opts.mode === 'range' ? 'custom' : opts.mode, mapId: opts.mapId,
        team: opts.team, botsPerSide: opts.botsPerSide, tier: opts.tier,
        roomCode: this.roomCode || opts.roomCode, spectate: opts.spectate ?? false,
      });
    };
    ws.onmessage = (ev: MessageEvent) => this.receive(ev.data);
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws !== ws) return;
      this.stopPing();
      this.ws = null;
      if (this.destroyed || this.finished) { this.onState?.('closed'); return; }
      this.scheduleReconnect(ev.reason || (ev.code === 1008 ? 'bị máy chủ ngắt' : 'mất kết nối'));
    };
    ws.onerror = () => { /* onclose xử lý */ };
  }

  private scheduleReconnect(reason: string): void {
    if (this.attempt >= RETRY_DELAYS_MS.length) {
      this.onState?.('closed', reason);
      this.fail(`Không kết nối lại được máy chủ: ${reason}`);
      return;
    }
    const delay = RETRY_DELAYS_MS[this.attempt++]!;
    this.onState?.('reconnecting', `${reason} · thử lại sau ${(delay / 1000).toFixed(1)}s`);
    this.reconnectTimer = globalThis.setTimeout(() => this.open(), delay) as unknown as number;
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') {
      if (!(data instanceof ArrayBuffer) || !this.decode) return;
      try {
        // Frame của gameserver: byte 0 = 1 (marker snapshot), phần còn lại là gói protocol.
        const frame = new Uint8Array(data);
        const body = frame.byteLength > 1 && frame[0] === 1 ? frame.subarray(1) : frame;
        const snap = this.decode(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
        this.latestTick = Math.max(this.latestTick, snap.tick);
        this.onSnapshot?.(snap, snap.tick);
      } catch (err) {
        this.onError?.(`Giải mã snapshot lỗi: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    let msg: ServerMsg;
    try { msg = JSON.parse(data) as ServerMsg; } catch { return; }
    switch (msg.t) {
      case 'welcome': {
        this.welcomed = true;
        this.roomCode = msg.code;
        const info: ReadyInfo = {
          youId: msg.youId,
          mapId: msg.mapId,
          roster: msg.roster.map((r) => ({ id: r.id, name: r.name, team: r.team, bot: r.bot, tier: r.tier, role: r.role })),
        };
        this.readyResolve?.(info);
        this.readyResolve = null;
        this.readyReject = null;
        this.onReady?.(info);
        this.onState?.('open');
        this.startPing();
        break;
      }
      case 'roster':
        this.onRoster?.(msg.roster.map((r) => ({ id: r.id, name: r.name, team: r.team, bot: r.bot, tier: r.tier, role: r.role })));
        break;
      case 'buy_result': this.onBuyResult?.(msg.ok, msg.itemId, msg.reason); break;
      case 'chat': this.onChat?.(msg.from, msg.text, msg.team, msg.bot); break;
      case 'pong':
        this.latencyMs = Math.max(0, Math.min(999, Math.round(performance.now() - msg.clientTime)));
        break;
      case 'match_end': this.finished = true; this.onMatchEnd?.(msg.winner === 'CT' ? 'CT' : 'T'); break;
      case 'kill': break; // sự kiện kill đã có trong snapshot
      case 'error':
        if (!this.welcomed) { this.fail(msg.message); return; }
        if (msg.code !== 'rate_limited') this.onError?.(msg.message);
        break;
      default: break;
    }
  }

  private startPing(): void {
    this.stopPing();
    const ping = (): void => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.pingSentAt = performance.now();
      this.send({ t: 'ping', clientTime: this.pingSentAt });
    };
    ping();
    this.pingTimer = globalThis.setInterval(ping, 2500) as unknown as number;
  }

  private stopPing(): void {
    if (this.pingTimer) { globalThis.clearInterval(this.pingTimer); this.pingTimer = 0; }
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private fail(message: string): void {
    this.onError?.(message);
    this.readyReject?.(new Error(message));
    this.readyResolve = null;
    this.readyReject = null;
  }

  sendInput(input: { seq: number; tick: number; forward: number; right: number; yaw: number; pitch: number; buttons: number; grenadeSlot: number }): void {
    this.send({ t: 'input', ...input, viewTick: input.tick });
  }

  buy(itemId: string): void { this.send({ t: 'buy', item: itemId }); }

  chat(text: string, teamOnly = false): void { this.send({ t: 'chat', text, teamOnly }); }

  /** Online không tạm dừng mô phỏng: mở menu không dừng trận trên máy chủ. */
  pause(): void { /* no-op */ }
  resume(): void { /* không cần đồng bộ */ }

  destroy(): void {
    this.destroyed = true;
    this.stopPing();
    if (this.reconnectTimer) { globalThis.clearTimeout(this.reconnectTimer); this.reconnectTimer = 0; }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      this.send({ t: 'leave' });
      try { ws.close(1000, 'leave'); } catch { /* đã đóng */ }
    }
    this.readyResolve = null;
    this.readyReject = null;
    this.options = null;
    this.decode = null;
    this.latestTick = 0;
  }
}
