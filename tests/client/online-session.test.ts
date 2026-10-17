import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProtocolCatalog, decodeSnapshot, type NetSnapshot } from '@tactical/shared';
import { createRuntime } from '../../apps/gameserver/src/index';
import { OnlineSession } from '../../apps/client/src/sim/online';
import type { OfflineOptions } from '../../apps/client/src/sim/protocol';
import { loadData } from '../../apps/client/src/data';

describe('OnlineSession ↔ gameserver', () => {
  let runtime: ReturnType<typeof createRuntime>;
  let wsUrl = '';
  let catalog: ProtocolCatalog;

  beforeAll(async () => {
    catalog = new ProtocolCatalog(loadData().data);
    runtime = createRuntime({ port: 0, host: '127.0.0.1', logLevel: 'silent' });
    const addr = await runtime.listen();
    wsUrl = addr.replace('http://', 'ws://') + '/ws';
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('hello → welcome → snapshot nhị phân → mua/chat/ping', async () => {
    const session = new OnlineSession();
    const snaps: NetSnapshot[] = [];
    const chats: string[] = [];
    const errors: string[] = [];
    let buyOk: boolean | null = null;
    session.onSnapshot = (snap) => { snaps.push(snap); };
    session.onError = (m) => { errors.push(m); };
    session.onChat = (from, text) => { chats.push(`${from}:${text}`); };
    session.onBuyResult = (ok) => { buyOk = ok; };
    const options: OfflineOptions = {
      name: 'TestPilot', mode: 'quick', mapId: 'sandstorm', team: 'T',
      botsPerSide: 1, tier: 'rookie', url: wsUrl, seed: 7,
    };
    const ready = await session.start(options, (buf) => decodeSnapshot(new Uint8Array(buf), null, catalog));
    expect(ready.youId).toBeGreaterThanOrEqual(0);
    expect(ready.roster.some((r) => r.id === ready.youId && r.bot === false)).toBe(true);
    expect(ready.roster.some((r) => r.bot)).toBe(true);

    session.sendInput({ seq: 1, tick: 0, forward: 1, right: 0, yaw: 0, pitch: 0, buttons: 0, grenadeSlot: 0 });
    session.buy('pistol_t');
    session.chat('xin chào');
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !(snaps.length > 0 && buyOk === true && chats.length > 0)) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(errors).toEqual([]);
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[snaps.length - 1]!.self.id).toBe(ready.youId);
    expect(buyOk).toBe(true);
    expect(chats.some((c) => c.includes('xin chào'))).toBe(true);
    expect(session.latencyMs).toBeGreaterThanOrEqual(0);
    session.destroy();
  });
});
