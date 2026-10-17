import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRuntime } from '../src/index';

let runtime: ReturnType<typeof createRuntime>;
let httpUrl = '';
let wsUrl = '';

beforeAll(async () => {
  runtime = createRuntime({ port: 0, host: '127.0.0.1', logLevel: 'silent' });
  httpUrl = await runtime.listen();
  wsUrl = httpUrl.replace('http://', 'ws://') + '/ws';
});

afterAll(async () => {
  await runtime.close();
});

describe('gameserver phòng đấu', () => {
  it('sức khoẻ và danh sách phòng', async () => {
    const health = await fetch(`${httpUrl}/healthz`);
    expect(health.status).toBe(200);
    const body = await health.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    const metrics = await fetch(`${httpUrl}/metrics`);
    expect(metrics.status).toBe(200);
  });

  it('khách vào phòng, nhận welcome + snapshot, bot có nhãn BOT', async () => {
    const ws = new WebSocket(wsUrl, { origin: 'http://localhost:5173' });
    const welcome = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout welcome')), 8000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'hello', name: 'Tester', mode: 'quick', mapId: 'sandstorm', botsPerSide: 1, tier: 'regular' }));
      });
      ws.on('error', reject);
      ws.on('message', (data, binary) => {
        if (binary) return;
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.t === 'welcome') { clearTimeout(timer); resolve(msg); }
      });
    });
    expect(welcome.youId).toBe(0);
    expect(Array.isArray(welcome.roster)).toBe(true);
    const roster = welcome.roster as { bot: boolean; name: string }[];
    expect(roster.some((r) => r.bot && r.name.startsWith('BOT '))).toBe(true);

    const snap = await new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout snapshot')), 8000);
      ws.on('message', (data, binary) => {
        if (!binary) return;
        clearTimeout(timer);
        resolve(new Uint8Array(data as Buffer));
      });
    });
    expect(snap[0]).toBe(1);
    expect(snap.byteLength).toBeGreaterThan(8);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  }, 15000);
});
