import Fastify, { type FastifyRequest } from 'fastify';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Logger } from 'pino';
import {
  CASHOUT_POLICY, SENSITIVE_FLAGS, flagsOf, loadBalance, loadConfig,
  type ApiConfig, type BalanceFile,
} from './config';
import { DomainError } from './domain';
import {
  LoginThrottle, hashPassword, hashToken, makeRefreshToken, passwordProblems, signAccess, verifyAccess, verifyPassword,
} from './auth';
import { createDb } from './db';
import { RedisLimiter } from './redis';
import { createApiLogger } from './logger';
import { createApiMetrics } from './metrics';
import type { SkinInstanceRow, StoreDb, StoreProduct, UserRow } from './types';

export interface ApiOptions {
  config?: ApiConfig;
  db?: StoreDb;
  logger?: Logger;
}

interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }

const RegisterBody = z.object({
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(1).max(200),
  displayName: z.string().min(1).max(24).optional(),
});
const LoginBody = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(200) });
const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });
const PurchaseBody = z.object({ productId: z.string().min(1).max(64) });
const ListingBody = z.object({ instanceId: z.string().uuid(), price: z.number().int().positive() });
const EquipBody = z.object({ instanceId: z.string().uuid(), weapon: z.string().min(1).max(32) });
const BuyBody = z.object({ idempotencyKey: z.string().min(8).max(80).optional() });

export interface ApiRuntime {
  app: ReturnType<typeof Fastify>;
  db: StoreDb;
  cfg: ApiConfig;
  balance: BalanceFile;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export function createApi(options: ApiOptions = {}): ApiRuntime {
  const cfg = options.config ?? loadConfig();
  const log = options.logger ?? createApiLogger(cfg);
  const db = options.db ?? createDb(cfg);
  const balance = loadBalance(cfg.DATA_DIR);
  const flags = flagsOf(cfg);
  const metrics = createApiMetrics();
  const loginThrottle = new LoginThrottle(12, 60_000);
  const ipThrottle = new LoginThrottle(240, 60_000);
  const redisLimiter = new RedisLimiter(cfg.REDIS_URL, log);
  const revoked = new Set<string>();
  const app = Fastify({ loggerInstance: log, bodyLimit: 16 * 1024, trustProxy: cfg.TRUST_PROXY });
  const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^https:\/\/[a-z0-9-]+\.e2b\.app$/i;

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin !== cfg.PUBLIC_ORIGIN && !allowedOrigin.test(origin)) {
      return reply.code(403).send({ error: 'origin_not_allowed' });
    }
    if (origin) reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
    reply.header('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type,authorization,idempotency-key');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'geolocation=(), microphone=(), camera=()');
    reply.header('cache-control', 'no-store');
    if (req.method === 'OPTIONS') return reply.code(204).send();
    if (req.method !== 'GET') {
      const ip = req.ip;
      if (!ipThrottle.check(ip)) return reply.code(429).send({ error: 'rate_limited' });
      if (!(await redisLimiter.allow(`api:${ip}`, 240, 60))) return reply.code(429).send({ error: 'rate_limited' });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid_body', issues: err.issues });
    }
    log.error({ err }, 'lỗi xử lý request');
    return reply.code(500).send({ error: 'internal_error' });
  });

  const userOf = async (req: FastifyRequest): Promise<{ claims: Awaited<ReturnType<typeof verifyAccess>>; user: UserRow }> => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new DomainError('unauthorized', 'Thiếu access token', 401);
    const claims = await verifyAccess(cfg, header.slice(7));
    if (!claims) throw new DomainError('unauthorized', 'Access token không hợp lệ', 401);
    if (revoked.has(claims.jti)) throw new DomainError('unauthorized', 'Token đã bị thu hồi', 401);
    const user = await db.userById(claims.sub);
    if (!user) throw new DomainError('unauthorized', 'Người dùng không tồn tại', 401);
    if (user.banned) throw new DomainError('forbidden', 'Tài khoản bị khoá', 403);
    return { claims, user };
  };

  const issueTokens = async (user: UserRow): Promise<TokenPair> => {
    const accessToken = await signAccess(cfg, { sub: user.id, name: user.displayName, guest: false });
    const refresh = makeRefreshToken();
    const now = Date.now();
    await db.saveRefresh({
      id: randomUUID(), userId: user.id, tokenHash: refresh.hash,
      familyId: randomUUID(), expiresAt: new Date(now + cfg.REFRESH_TTL_DAYS * 86400_000).toISOString(),
      revokedAt: null, createdAt: new Date(now).toISOString(),
    });
    return { accessToken, refreshToken: refresh.raw, expiresIn: cfg.ACCESS_TTL_SEC };
  };

  const idemKey = (req: FastifyRequest, body?: { idempotencyKey?: string }): string => {
    const header = req.headers['idempotency-key'];
    if (typeof header === 'string' && header.length >= 8) return header.slice(0, 80);
    if (body?.idempotencyKey) return body.idempotencyKey;
    throw new DomainError('invalid_posting', 'Thiếu Idempotency-Key', 400);
  };

  app.get('/healthz', async () => ({ ok: true, service: 'api', ts: Date.now(), db: db.kind }));
  app.get('/readyz', async () => ({ ok: true, db: db.kind }));
  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  app.get('/v1/meta', async () => ({
    flags, cashout: CASHOUT_POLICY, currency: 'Credits',
    legal: SENSITIVE_FLAGS.filter((f) => flags[f]).length === 0 ? 'default_off' : 'review_required',
    marketFeePercent: balance.economy.marketFeePercent,
  }));

  // ---------------- Auth ----------------
  app.post('/v1/auth/register', async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const problem = passwordProblems(body.password);
    if (problem) throw new DomainError('invalid_posting', problem, 400);
    const username = body.username;
    const existing = await db.userByName(username);
    if (existing) throw new DomainError('conflict', 'Tên đăng nhập đã tồn tại', 409);
    const user = await db.createUser(username, body.displayName ?? username, hashPassword(body.password), cfg.START_CREDITS);
    const tokens = await issueTokens(user);
    metrics.registrations.inc();
    reply.code(201);
    return { user: publicUser(user), credits: cfg.START_CREDITS, ...tokens };
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const throttleKey = `${req.ip}|${body.username.toLowerCase()}`;
    if (!loginThrottle.check(throttleKey)) {
      metrics.loginFailures.inc();
      return reply.code(429).send({ error: 'rate_limited', message: 'Thử lại sau ít phút' });
    }
    const user = await db.userByName(body.username);
    const ok = user ? verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      metrics.loginFailures.inc();
      throw new DomainError('unauthorized', 'Sai tên đăng nhập hoặc mật khẩu', 401);
    }
    loginThrottle.clear(throttleKey);
    await db.markLogin(user.id);
    const tokens = await issueTokens(user);
    return { user: publicUser(user), credits: await db.balance(user.id), ...tokens };
  });

  app.post('/v1/auth/refresh', async (req) => {
    const body = RefreshBody.parse(req.body);
    const hash = hashToken(body.refreshToken);
    const row = await db.refreshByHash(hash);
    if (!row) throw new DomainError('unauthorized', 'Refresh token không hợp lệ', 401);
    if (row.revokedAt) {
      await db.revokeFamily(row.familyId);
      throw new DomainError('unauthorized', 'Refresh token đã dùng; toàn bộ phiên bị thu hồi', 401);
    }
    if (Date.parse(row.expiresAt) < Date.now()) throw new DomainError('unauthorized', 'Refresh token hết hạn', 401);
    const user = await db.userById(row.userId);
    if (!user || user.banned) throw new DomainError('unauthorized', 'Tài khoản không khả dụng', 401);
    await db.revokeRefresh(row.id);
    const accessToken = await signAccess(cfg, { sub: user.id, name: user.displayName, guest: false });
    const refresh = makeRefreshToken();
    await db.saveRefresh({
      id: randomUUID(), userId: user.id, tokenHash: refresh.hash, familyId: row.familyId,
      expiresAt: new Date(Date.now() + cfg.REFRESH_TTL_DAYS * 86400_000).toISOString(),
      revokedAt: null, createdAt: new Date().toISOString(),
    });
    return { accessToken, refreshToken: refresh.raw, expiresIn: cfg.ACCESS_TTL_SEC };
  });

  app.post('/v1/auth/logout', async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const claims = await verifyAccess(cfg, header.slice(7));
      if (claims) revoked.add(claims.jti);
    }
    const body = z.object({ refreshToken: z.string().min(20).max(200) }).safeParse(req.body ?? {});
    if (body.success) {
      const row = await db.refreshByHash(hashToken(body.data.refreshToken));
      if (row) await db.revokeRefresh(row.id);
    }
    return { ok: true };
  });

  // ---------------- Profile ----------------
  app.get('/v1/me', async (req) => {
    const { user } = await userOf(req);
    const [credits, profile] = await Promise.all([db.balance(user.id), db.profile(user.id)]);
    return { user: publicUser(user), credits, profile, flags, cashout: CASHOUT_POLICY };
  });

  app.get('/v1/ledger', async (req) => {
    const { user } = await userOf(req);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query ?? {});
    return { entries: await db.ledger(user.id, q.limit) };
  });

  app.get('/v1/leaderboard', async () => ({ rows: await db.leaderboard(50) }));

  // ---------------- Store ----------------
  app.get('/v1/store', async () => {
    const products = balance.store.products
      .filter((p) => p.type !== 'loot_box' || flags.lootBoxes)
      .filter((p) => Array.isArray(p.items) && p.items.length > 0 && p.items.every((item) => balance.skins.skins.some((s) => s.id === item && s.status === 'active')));
    return { currency: 'Credits', products, note: 'Chỉ vật phẩm thẩm mỹ. Không loot box khi flag tắt.' };
  });

  app.post('/v1/store/purchase', async (req, reply) => {
    const { user } = await userOf(req);
    const body = PurchaseBody.parse(req.body);
    const key = idemKey(req);
    const product = balance.store.products.find((p) => p.id === body.productId);
    if (!product) throw new DomainError('not_found', 'Không có sản phẩm', 404);
    if (product.type === 'loot_box' && !flags.lootBoxes) throw new DomainError('feature_disabled', 'Loot box đang tắt', 403);
    if (!Array.isArray(product.items) || product.items.length === 0) throw new DomainError('product_unavailable', 'Sản phẩm không mua được', 409);
    const makeInstance = (skinId: string): SkinInstanceRow => {
      const def = balance.skins.skins.find((s) => s.id === skinId && s.status === 'active');
      if (!def) throw new DomainError('product_unavailable', 'Vật phẩm không khả dụng', 409);
      return {
        id: randomUUID(), ownerId: user.id, skinDefId: skinId,
        patternSeed: randomInt(0, 2 ** 31 - 1), wearFloat: randomInt(0, 10000) / 10000,
        acquiredAt: new Date().toISOString(), source: `store:${product.id}`, listed: false,
      };
    };
    const result = await db.purchaseProduct(user.id, { ...product, items: product.items ?? [] } as StoreProduct, key, makeInstance);
    reply.code(result.duplicated ? 200 : 201);
    metrics.storePurchases.inc();
    return { ok: true, duplicated: result.duplicated, granted: result.granted, credits: await db.balance(user.id) };
  });

  app.get('/v1/inventory', async (req) => {
    const { user } = await userOf(req);
    const items = await db.inventory(user.id);
    const profile = await db.profile(user.id);
    return {
      items: items.map((i) => ({
        ...i, skin: balance.skins.skins.find((s) => s.id === i.skinDefId) ?? null,
        equipped: Object.entries(profile.equipped).some(([, v]) => v === i.skinDefId),
      })),
      equipped: profile.equipped,
    };
  });

  app.post('/v1/inventory/equip', async (req) => {
    const { user } = await userOf(req);
    const body = EquipBody.parse(req.body);
    const inst = await db.instance(body.instanceId);
    if (!inst || inst.ownerId !== user.id) throw new DomainError('not_owner', 'Không sở hữu vật phẩm', 403);
    if (inst.listed) throw new DomainError('conflict', 'Vật phẩm đang niêm yết', 409);
    const def = balance.skins.skins.find((s) => s.id === inst.skinDefId);
    if (!def) throw new DomainError('not_found', 'Skin không tồn tại', 404);
    if (!def.weapons.includes(body.weapon) && body.weapon !== 'knife') throw new DomainError('invalid_posting', 'Skin không dùng được cho vũ khí này', 400);
    const profile = await db.profile(user.id);
    const equipped = { ...profile.equipped, [body.weapon]: inst.skinDefId };
    await db.setEquipped(user.id, equipped);
    await db.audit(user.id, 'inventory.equip', { instanceId: inst.id, weapon: body.weapon });
    return { ok: true, equipped };
  });

  // ---------------- Market ----------------
  app.get('/v1/market/listings', async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query ?? {});
    return { currency: 'Credits', feePercent: balance.economy.marketFeePercent, listings: await db.activeListings(q.limit) };
  });

  app.post('/v1/market/listing', async (req, reply) => {
    const { user } = await userOf(req);
    const body = ListingBody.parse(req.body);
    const listing = await db.createListing(user.id, body.instanceId, body.price, {
      minPrice: balance.economy.marketMinPrice, maxPrice: balance.economy.marketMaxPrice,
      maxOpen: balance.economy.marketMaxOpenListings, lockHours: balance.economy.marketTradeLockHours,
    });
    reply.code(201);
    return { ok: true, listing };
  });

  app.delete('/v1/market/listings/:id', async (req) => {
    const { user } = await userOf(req);
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    await db.cancelListing(user.id, params.id);
    return { ok: true };
  });

  app.post('/v1/market/listings/:id/buy', async (req) => {
    const { user } = await userOf(req);
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = BuyBody.parse(req.body ?? {});
    const key = idemKey(req, body);
    const trade = await db.buyListing(user.id, params.id, key, balance.economy.marketFeePercent);
    metrics.marketTrades.inc();
    return { ok: true, trade, credits: await db.balance(user.id) };
  });


  return {
    app, db, cfg, balance,
    async listen(): Promise<string> {
      await app.listen({ port: cfg.PORT_API, host: cfg.HOST });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : cfg.PORT_API;
      log.info({ port, db: db.kind }, 'api sẵn sàng');
      return `http://127.0.0.1:${port}`;
    },
    async close(): Promise<void> {
      await redisLimiter.close();
      await db.close();
      await app.close();
    },
  };
}

function publicUser(u: UserRow): { id: string; username: string; displayName: string; createdAt: string } {
  return { id: u.id, username: u.username, displayName: u.displayName, createdAt: u.createdAt };
}
