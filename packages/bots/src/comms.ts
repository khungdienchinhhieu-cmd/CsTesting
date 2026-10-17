import { BOT_TICK_RATE, type BotCommsMessage } from '@tactical/shared/bot-api';

export interface PendingComms {
  fromId: number;
  team: 'T' | 'CT';
  message: BotCommsMessage;
  deliverTick: number;
}

export class CommsChannel {
  private pending: PendingComms[] = [];
  private deliveredByBot = new Map<number, BotCommsMessage[]>();

  send(fromId: number, team: 'T' | 'CT', kind: BotCommsMessage['kind'], text: string, tick: number, delaySec: number, x?: number, y?: number, z?: number, confidence = 0.8): void {
    this.pending.push({
      fromId, team,
      message: { fromId, kind, text, x, y, z, confidence, tickReceived: tick + Math.round(delaySec * BOT_TICK_RATE) },
      deliverTick: tick + Math.round(delaySec * BOT_TICK_RATE),
    });
  }

  /** Gọi mỗi lần think của bất kỳ bot nào để phát các tin đã tới hạn. */
  pump(tick: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      if (tick >= p.deliverTick) {
        this.pending.splice(i, 1);
        const list = this.deliveredByBot.get(p.fromId) ?? [];
        list.push(p.message);
        if (list.length > 12) list.shift();
        this.deliveredByBot.set(p.fromId, list);
      }
    }
  }

  getFor(botId: number, tick: number): BotCommsMessage[] {
    const out: BotCommsMessage[] = [];
    for (const [fromId, list] of this.deliveredByBot) {
      if (fromId === botId) continue;
      for (const m of list) {
        if (tick - m.tickReceived < BOT_TICK_RATE * 8) out.push(m);
      }
    }
    return out.slice(-10);
  }

  clear(): void { this.pending.length = 0; this.deliveredByBot.clear(); }
}
