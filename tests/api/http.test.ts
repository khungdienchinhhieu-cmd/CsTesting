import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi, type ApiRuntime } from '../../apps/api/src/app';
import { loadConfig } from '../../apps/api/src/config';
import { MemoryDb } from '../../apps/api/src/store-memory';

let api: ApiRuntime;
let db: MemoryDb;

async function register(username: string): Promise<{ token: string; refreshToken: string; id: string }> {
  const res = await api.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'correct-horse-1' } });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { accessToken: string; refreshToken: string; user: { id: string } };
  return { token: body.accessToken, refreshToken: body.refreshToken, id: body.user.id };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const cfg = loadConfig({ ...process.env, NODE_ENV: 'test', JWT_ACCESS_SECRET: 'test-secret-that-is-long-enough' });
  api = createApi({ config: cfg });
  db = api.db as MemoryDb;
  await db.init();
  await api.app.ready();
});

afterAll(async () => { await api.close(); });

describe('API xác thực', () => {
  it('đăng ký, /me, refresh rotation và phát hiện token tái sử dụng', async () => {
    const a = await register('alice');
    const me = await api.app.inject({ method: 'GET', url: '/v1/me', headers: auth(a.token) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { credits: number }).credits).toBe(2500);

    const r1 = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: a.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const t1 = r1.json() as { accessToken: string; refreshToken: string };

    const reuse = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: a.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    // Dùng lại token cũ thu hồi cả family: token mới cũng không dùng được.
    const afterReuse = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: t1.refreshToken } });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('logout thu hồi access token', async () => {
    const b = await register('bobby');
    const out = await api.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: auth(b.token), payload: {} });
    expect(out.statusCode).toBe(200);
    const me = await api.app.inject({ method: 'GET', url: '/v1/me', headers: auth(b.token) });
    expect(me.statusCode).toBe(401);
  });

  it('từ chối request không có token và mật khẩu yếu', async () => {
    const me = await api.app.inject({ method: 'GET', url: '/v1/me' });
    expect(me.statusCode).toBe(401);
    const weak = await api.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'weakone', password: 'short' } });
    expect(weak.statusCode).toBe(400);
  });
});

describe('API cửa hàng và chợ', () => {
  it('mua skin idempotent, số dư chỉ trừ một lần', async () => {
    const c = await register('carol');
    const buy = await api.app.inject({
      method: 'POST', url: '/v1/store/purchase', headers: { ...auth(c.token), 'idempotency-key': 'store_buy_key_1' },
      payload: { productId: 'store_dune_pack' },
    });
    expect(buy.statusCode).toBe(201);
    const again = await api.app.inject({
      method: 'POST', url: '/v1/store/purchase', headers: { ...auth(c.token), 'idempotency-key': 'store_buy_key_1' },
      payload: { productId: 'store_dune_pack' },
    });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { duplicated: boolean }).duplicated).toBe(true);
    const me = await api.app.inject({ method: 'GET', url: '/v1/me', headers: auth(c.token) });
    expect((me.json() as { credits: number }).credits).toBe(1300);
    const inv = await api.app.inject({ method: 'GET', url: '/v1/inventory', headers: auth(c.token) });
    expect((inv.json() as { items: unknown[] }).items.length).toBe(2);
  });

  it('niêm yết và mua qua chợ, seller nhận tiền sau phí', async () => {
    const seller = await register('sellersam');
    const buyer = await register('buyerkim');
    db.seedInstance({
      id: crypto.randomUUID(), ownerId: seller.id, skinDefId: 'finish_night_grid', patternSeed: 7,
      wearFloat: 0.2, acquiredAt: new Date(Date.now() - 9 * 86400_000).toISOString(), source: 'drop', listed: false,
    });
    const inv = await api.app.inject({ method: 'GET', url: '/v1/inventory', headers: auth(seller.token) });
    const instId = (inv.json() as { items: { id: string }[] }).items[0]!.id;
    const listing = await api.app.inject({
      method: 'POST', url: '/v1/market/listing', headers: auth(seller.token),
      payload: { instanceId: instId, price: 500 },
    });
    expect(listing.statusCode).toBe(201);
    const listingId = (listing.json() as { listing: { id: string } }).listing.id;
    const bought = await api.app.inject({
      method: 'POST', url: `/v1/market/listings/${listingId}/buy`,
      headers: { ...auth(buyer.token), 'idempotency-key': 'market_buy_key_1' },
    });
    expect(bought.statusCode).toBe(200);
    expect((bought.json() as { trade: { fee: number } }).trade.fee).toBe(50);
    const sellerMe = await api.app.inject({ method: 'GET', url: '/v1/me', headers: auth(seller.token) });
    expect((sellerMe.json() as { credits: number }).credits).toBe(2950);
    const buyerMe = await api.app.inject({ method: 'GET', url: '/v1/me', headers: auth(buyer.token) });
    expect((buyerMe.json() as { credits: number }).credits).toBe(2000);
    const ledger = await api.app.inject({ method: 'GET', url: '/v1/ledger', headers: auth(buyer.token) });
    expect((ledger.json() as { entries: unknown[] }).entries.length).toBeGreaterThan(0);
  });
});
