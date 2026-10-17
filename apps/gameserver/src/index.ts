import Fastify from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { loadServerData } from './data';
import { TokenVerifier, type AuthedUser } from './auth';
import { RoomManager } from './rooms';
import { ClientMessage } from './protocol';
import { registry } from './metrics';

export interface RuntimeOptions {
  port?: number;
  host?: string;
  logLevel?: string;
}

const RoomBody = z.object({
  mode: z.enum(['competitive', 'quick', 'deathmatch', 'custom']).default('competitive'),
  mapId: z.enum(['sandstorm', 'warehouse', 'range']).default('sandstorm'),
  botsPerSide: z.number().int().min(0).max(5).default(4),
  tier: z.string().max(16).default('regular'),
  roundsToWin: z.number().int().min(1).max(30).optional(),
  maxRounds: z.number().int().min(1).max(60).optional(),
});

export function createRuntime(options: RuntimeOptions = {}) {
  const baseCfg = loadConfig();
  const cfg = {
    ...baseCfg,
    ...(options.port !== undefined ? { PORT_GAMESERVER: options.port } : {}),
    ...(options.host !== undefined ? { HOST: options.host } : {}),
    ...(options.logLevel !== undefined ? { LOG_LEVEL: options.logLevel as typeof baseCfg.LOG_LEVEL } : {}),
  };
  const log = createLogger(cfg);
  const data = loadServerData(cfg.DATA_DIR);
  const manager = new RoomManager(data.data, data.maps, data.bots, log, cfg.MAX_ROOMS);
  const tokens = new TokenVerifier(cfg);
  const app = Fastify({ loggerInstance: log, bodyLimit: 16 * 1024, trustProxy: true });
  const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/[a-z0-9-]+\.e2b\.app$/i;

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin !== cfg.PUBLIC_ORIGIN && !allowedOrigin.test(origin)) {
      reply.code(403).send({ error: 'origin_not_allowed' });
      return;
    }
    if (origin) reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
    reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type,authorization');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'geolocation=(), microphone=(), camera=()');
    if (req.method === 'OPTIONS') { reply.code(204).send(); }
  });

  app.get('/healthz', async () => ({ ok: true, service: 'gameserver', ts: Date.now() }));
  app.get('/readyz', async () => ({ ok: true, rooms: manager.size }));
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
  app.get('/v1/rooms', async () => ({ rooms: manager.list() }));
  app.post('/v1/rooms', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' });
    const user = await tokens.verify(auth.slice(7));
    if (!user) return reply.code(401).send({ error: 'invalid_token' });
    const parsed = RoomBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.issues });
    const room = manager.create({
      mode: parsed.data.mode, mapId: parsed.data.mapId, botsPerSide: parsed.data.botsPerSide,
      tier: parsed.data.tier, roundsToWin: parsed.data.roundsToWin, maxRounds: parsed.data.maxRounds,
      privateRoom: true,
    });
    log.info({ user: user.id, code: room.code }, 'tạo phòng riêng');
    return { code: room.code, roomId: room.id };
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  app.server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const origin = req.headers.origin;
    if (origin && origin !== cfg.PUBLIC_ORIGIN && !allowedOrigin.test(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    let joined = false;
    let user: AuthedUser | null = null;
    let room: ReturnType<RoomManager['create']> | null = null;
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, 30_000);
    const helloTimer = setTimeout(() => { if (!joined) ws.close(1008, 'hello timeout'); }, 8_000);

    ws.on('message', (raw, isBinary) => {
      if (!joined) {
        if (isBinary) { ws.close(1008, 'expected hello'); return; }
        let parsed;
        try { parsed = ClientMessage.safeParse(JSON.parse(raw.toString())); } catch { ws.close(1003, 'bad json'); return; }
        if (!parsed.success || parsed.data.t !== 'hello') { ws.close(1008, 'expected hello'); return; }
        const hello = parsed.data;
        void (async () => {
          user = (await tokens.verify(hello.token)) ?? null;
          if (!user) {
            if (!cfg.ALLOW_GUEST || cfg.NODE_ENV === 'production') {
              ws.close(1008, 'unauthorized'); return;
            }
            user = { id: `guest_${Math.random().toString(36).slice(2, 10)}`, name: hello.name || `Guest-${Math.floor(Math.random() * 9000 + 1000)}`, guest: true };
          }
          if (hello.name && !user.guest) user = { ...user, name: hello.name };
          const target = hello.roomCode ? manager.get(hello.roomCode) : null;
          if (hello.roomCode && !target) { ws.send(JSON.stringify({ t: 'error', code: 'room_not_found', message: 'Không tìm thấy phòng' })); ws.close(1008, 'not found'); return; }
          room = target ?? manager.findOrCreate({
            mode: hello.mode, mapId: hello.mapId, botsPerSide: hello.botsPerSide, tier: hello.tier,
            roundsToWin: hello.roundsToWin, maxRounds: hello.maxRounds, privateRoom: false,
          });
          joined = true;
          clearTimeout(helloTimer);
          room.join(ws, user, hello);
        })();
        return;
      }
      if (!room) return;
      let parsed;
      try {
        const obj = isBinary ? null : JSON.parse(raw.toString());
        if (!obj) { ws.close(1003, 'binary not allowed'); return; }
        parsed = ClientMessage.safeParse(obj);
      } catch { ws.close(1003, 'bad json'); return; }
      if (!parsed.success) {
        ws.send(JSON.stringify({ t: 'error', code: 'bad_message', message: 'Tin nhắn không hợp lệ' }));
        return;
      }
      room.handleMessage(ws, parsed.data);
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(helloTimer);
      if (room && joined) room.leave(ws);
    });
    ws.on('error', () => { /* đóng ở close */ });
    void req;
  });

  return {
    app, manager, wss, cfg, log, data,
    async listen(): Promise<string> {
      await app.listen({ port: cfg.PORT_GAMESERVER, host: cfg.HOST });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : cfg.PORT_GAMESERVER;
      log.info({ port }, 'gameserver sẵn sàng');
      return `http://127.0.0.1:${port}`;
    },
    async close(): Promise<void> {
      wss.close();
      manager.shutdown();
      await app.close();
    },
  };
}

const isMain = typeof require !== 'undefined' && require.main === module;
if (isMain) {
  const runtime = createRuntime();
  void runtime.listen();
  const shutdown = (signal: string) => {
    runtime.log.info({ signal }, 'tắt server');
    void runtime.close().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

