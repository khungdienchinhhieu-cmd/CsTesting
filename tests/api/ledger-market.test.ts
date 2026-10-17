import { describe, expect, it } from 'vitest';
import { MemoryDb } from '../../apps/api/src/store-memory';
import { DomainError, postLedger } from '../../apps/api/src/domain';

async function setup() {
  const db = new MemoryDb();
  await db.init();
  const seller = await db.createUser('seller', 'Seller', 'hash', 10_000);
  const buyerA = await db.createUser('buyer_a', 'Buyer A', 'hash', 10_000);
  const buyerB = await db.createUser('buyer_b', 'Buyer B', 'hash', 10_000);
  return { db, seller, buyerA, buyerB };
}

describe('sổ cái ghi kép', () => {
  it('cấn trừ đúng và chặn chi vượt số dư', async () => {
    const { db, buyerA } = await setup();
    const acc = await db.accountForUser(buyerA.id);
    const treasury = await db.systemAccount('treasury');
    const r = await postLedger(db.asLedgerTxForTest(), {
      kind: 'test', userId: buyerA.id, idempotencyKey: 'ledger_test_1', memo: 'test',
      entries: [{ accountId: acc.id, delta: -500 }, { accountId: treasury.id, delta: 500 }],
    });
    expect(r.duplicated).toBe(false);
    expect(await db.balance(buyerA.id)).toBe(9500);
    await expect(postLedger(db.asLedgerTxForTest(), {
      kind: 'test', userId: buyerA.id, idempotencyKey: 'ledger_test_2', memo: 'quá số dư',
      entries: [{ accountId: acc.id, delta: -999999 }, { accountId: treasury.id, delta: 999999 }],
    })).rejects.toMatchObject({ code: 'insufficient_funds' });
  });

  it('idempotency: gọi lại cùng key không trừ hai lần', async () => {
    const { db, buyerA } = await setup();
    const acc = await db.accountForUser(buyerA.id);
    const fee = await db.systemAccount('fee');
    const input = {
      kind: 'test', userId: buyerA.id, idempotencyKey: 'same_key_123', memo: 'một lần',
      entries: [{ accountId: acc.id, delta: -250 }, { accountId: fee.id, delta: 250 }],
    };
    const [a, b] = await Promise.all([db.run((tx) => postLedger(tx, input)), db.run((tx) => postLedger(tx, input))]);
    expect(a.txId).toBe(b.txId);
    expect([a.duplicated, b.duplicated].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(await db.balance(buyerA.id)).toBe(9750);
  });

  it('tổng bút toán phải bằng 0', async () => {
    const { db, buyerA } = await setup();
    const acc = await db.accountForUser(buyerA.id);
    const other = await db.systemAccount('treasury');
    await expect(postLedger(db.asLedgerTxForTest(), {
      kind: 'bad', userId: buyerA.id, idempotencyKey: 'bad_sum_1', memo: 'lệch',
      entries: [{ accountId: acc.id, delta: -100 }, { accountId: other.id, delta: 90 }],
    })).rejects.toBeInstanceOf(DomainError);
  });
});

describe('chợ và race condition', () => {
  async function seedListing() {
    const ctx = await setup();
    const inst = {
      id: crypto.randomUUID(), ownerId: ctx.seller.id, skinDefId: 'finish_night_grid',
      patternSeed: 42, wearFloat: 0.12, acquiredAt: new Date(Date.now() - 9 * 86400_000).toISOString(),
      source: 'drop', listed: false,
    };
    ctx.db.seedInstance(inst);
    const listing = await ctx.db.createListing(ctx.seller.id, inst.id, 1000, { minPrice: 1, maxPrice: 2_000_000, maxOpen: 20, lockHours: 168 });
    return { ...ctx, inst, listing };
  }

  it('mua thành công: buyer trả, seller nhận sau phí, fee vào tài khoản phí', async () => {
    const { db, buyerA, seller, listing } = await seedListing();
    const trade = await db.buyListing(buyerA.id, listing.id, 'buy_key_0001', 10);
    expect(trade.price).toBe(1000);
    expect(trade.fee).toBe(100);
    expect(await db.balance(buyerA.id)).toBe(9000);
    expect(await db.balance(seller.id)).toBe(10_900);
    expect((await db.systemAccount('fee')).balance).toBe(100);
    const inst = await db.instance(listing.instanceId);
    expect(inst?.ownerId).toBe(buyerA.id);
  });

  it('hai người mua khác key đồng thời: chỉ một người thắng', async () => {
    const { db, buyerA, buyerB, listing } = await seedListing();
    const results = await Promise.allSettled([
      db.buyListing(buyerA.id, listing.id, 'race_key_aaa', 10),
      db.buyListing(buyerB.id, listing.id, 'race_key_bbb', 10),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    const winner = ok[0] as PromiseFulfilledResult<{ buyerId: string; price: number }>;
    expect(winner.value.price).toBe(1000);
    const spentA = 10_000 - (await db.balance(buyerA.id));
    const spentB = 10_000 - (await db.balance(buyerB.id));
    expect(spentA + spentB).toBe(1000);
  });

  it('cùng key đồng thời: idempotent, chỉ trừ tiền một lần', async () => {
    const { db, buyerA, listing } = await seedListing();
    const [a, b] = await Promise.all([
      db.buyListing(buyerA.id, listing.id, 'same_trade_key', 10),
      db.buyListing(buyerA.id, listing.id, 'same_trade_key', 10),
    ]);
    expect(a.id).toBe(b.id);
    expect(await db.balance(buyerA.id)).toBe(9000);
  });
});
