import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { DomainError, type PostingInput, type PostingResult } from './domain';
import type {
  LedgerView, MarketListingView, ProfileRow, PurchaseProductResult, RefreshRow, SkinInstanceRow,
  StoreDb, StoreProduct, TradeView, UserRow,
} from './types';

interface AccountDb { id: string; kind: string; owner_id: string | null; balance: string; allow_negative: boolean }

function toUser(r: QueryResultRow): UserRow {
  return {
    id: r.id as string, username: r.username as string, displayName: r.display_name as string,
    passwordHash: r.password_hash as string, createdAt: new Date(r.created_at as string).toISOString(),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at as string).toISOString() : null,
    banned: r.banned as boolean,
  };
}

function toInstance(r: QueryResultRow): SkinInstanceRow {
  return {
    id: r.id as string, ownerId: r.owner_id as string, skinDefId: r.skin_def_id as string,
    patternSeed: Number(r.pattern_seed), wearFloat: Number(r.wear_float),
    acquiredAt: new Date(r.acquired_at as string).toISOString(), source: r.source as string,
    listed: r.listed as boolean,
  };
}

export class PostgresDb implements StoreDb {
  readonly kind = 'postgres' as const;
  private pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30_000, statement_timeout: 15_000, connectionTimeoutMillis: 10_000 });
  }

  async init(): Promise<void> {
    const r = await this.pool.query<{ ok: number }>('select 1 as ok');
    if (r.rows[0]?.ok !== 1) throw new Error('[db] không kết nối được PostgreSQL');
    const systems = await this.pool.query("select count(*)::int as n from ledger_accounts where owner_id is null and kind in ('treasury','fee','escrow')");
    if (Number((systems.rows[0] as { n: number }).n) !== 3) throw new Error('[db] thiếu tài khoản hệ thống; chạy migrations');
  }
  async close(): Promise<void> { await this.pool.end(); }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async accountForUser(c: PoolClient, userId: string): Promise<AccountDb> {
    const r = await c.query<AccountDb>('select id, kind, owner_id, balance::text as balance, allow_negative from ledger_accounts where owner_id = $1', [userId]);
    const row = r.rows[0];
    if (!row) throw new DomainError('account_missing', 'Tài khoản Credits không tồn tại', 404);
    return row;
  }
  private async systemAccount(c: PoolClient, kind: 'treasury' | 'fee' | 'escrow'): Promise<AccountDb> {
    const r = await c.query<AccountDb>('select id, kind, owner_id, balance::text as balance, allow_negative from ledger_accounts where owner_id is null and kind = $1', [kind]);
    const row = r.rows[0];
    if (!row) throw new DomainError('account_missing', 'Tài khoản hệ thống không tồn tại');
    return row;
  }

  private async postInClient(c: PoolClient, input: PostingInput): Promise<PostingResult> {
    if (input.entries.length < 2) throw new DomainError('invalid_posting', 'Bút toán cần ít nhất 2 tài khoản');
    const ids = [...new Set(input.entries.map((e) => e.accountId))].sort();
    let sum = 0;
    for (const e of input.entries) {
      if (!Number.isSafeInteger(e.delta) || e.delta === 0) throw new DomainError('invalid_posting', 'Bút toán không hợp lệ');
      sum += e.delta;
    }
    if (sum !== 0) throw new DomainError('invalid_posting', 'Tổng bút toán phải bằng 0');
    const accs = await c.query<AccountDb>(
      'select id, kind, owner_id, balance::text as balance, allow_negative from ledger_accounts where id = any($1::uuid[]) order by id for update',
      [ids],
    );
    if (accs.rows.length !== ids.length) throw new DomainError('account_missing', 'Tài khoản không tồn tại');
    const byId = new Map(accs.rows.map((a) => [a.id, a]));
    for (const e of input.entries) {
      const acc = byId.get(e.accountId)!;
      if (!acc.allow_negative && Number(acc.balance) + e.delta < 0) throw new DomainError('insufficient_funds', 'Không đủ Credits', 409);
    }
    const txId = randomUUID();
    const ins = await c.query<{ id: string }>(
      `insert into ledger_transactions (id, kind, user_id, idem_key, memo, metadata)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id, idem_key) do nothing returning id`,
      [txId, input.kind, input.userId, input.idempotencyKey, input.memo, JSON.stringify(input.metadata ?? {})],
    );
    if (!ins.rows[0]) {
      const prev = await c.query<{ id: string }>('select id from ledger_transactions where user_id=$1 and idem_key=$2', [input.userId, input.idempotencyKey]);
      return { txId: prev.rows[0]?.id ?? '', duplicated: true };
    }
    for (const e of input.entries) {
      await c.query('insert into ledger_entries (tx_id, account_id, delta) values ($1,$2,$3)', [ins.rows[0].id, e.accountId, e.delta]);
      await c.query('update ledger_accounts set balance = balance + $2 where id = $1', [e.accountId, e.delta]);
    }
    return { txId: ins.rows[0].id, duplicated: false };
  }

  async createUser(username: string, displayName: string, passwordHash: string, startCredits: number): Promise<UserRow> {
    return this.tx(async (c) => {
      const id = randomUUID();
      let r;
      try {
        r = await c.query('insert into users (id, username, display_name, password_hash) values ($1,$2,$3,$4) returning *', [id, username, displayName, passwordHash]);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new DomainError('conflict', 'Tên đăng nhập đã tồn tại', 409);
        throw err;
      }
      await c.query('insert into profiles (user_id) values ($1)', [id]);
      const accId = randomUUID();
      await c.query("insert into ledger_accounts (id, owner_id, kind, balance) values ($1,$2,'user',0)", [accId, id]);
      const treasury = await this.systemAccount(c, 'treasury');
      await this.postInClient(c, {
        kind: 'account_start', userId: id, idempotencyKey: `start_${id}`, memo: 'Credits khởi tạo tài khoản',
        entries: [{ accountId: treasury.id, delta: -startCredits }, { accountId: accId, delta: startCredits }],
      });
      const user = toUser(r.rows[0]);
      await c.query('insert into audit_log (actor_id, action, payload) values ($1,$2,$3)', [id, 'auth.register', JSON.stringify({ username })]);
      return user;
    });
  }

  async userByName(username: string): Promise<UserRow | null> {
    const r = await this.pool.query('select * from users where lower(username)=lower($1)', [username]);
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }
  async userById(id: string): Promise<UserRow | null> {
    const r = await this.pool.query('select * from users where id=$1', [id]);
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }
  async markLogin(id: string): Promise<void> { await this.pool.query('update users set last_login_at=now() where id=$1', [id]); }

  async saveRefresh(row: RefreshRow): Promise<void> {
    await this.pool.query(
      'insert into refresh_tokens (id,user_id,token_hash,family_id,expires_at,revoked_at,created_at) values ($1,$2,$3,$4,$5,$6,$7)',
      [row.id, row.userId, row.tokenHash, row.familyId, row.expiresAt, row.revokedAt, row.createdAt],
    );
  }
  async refreshByHash(hash: string): Promise<RefreshRow | null> {
    const r = await this.pool.query('select * from refresh_tokens where token_hash=$1', [hash]);
    const x = r.rows[0];
    return x ? {
      id: x.id as string, userId: x.user_id as string, tokenHash: x.token_hash as string, familyId: x.family_id as string,
      expiresAt: new Date(x.expires_at as string).toISOString(), revokedAt: x.revoked_at ? new Date(x.revoked_at as string).toISOString() : null,
      createdAt: new Date(x.created_at as string).toISOString(),
    } : null;
  }
  async revokeRefresh(id: string): Promise<void> { await this.pool.query('update refresh_tokens set revoked_at=coalesce(revoked_at, now()) where id=$1', [id]); }
  async revokeFamily(familyId: string): Promise<void> { await this.pool.query('update refresh_tokens set revoked_at=coalesce(revoked_at, now()) where family_id=$1', [familyId]); }

  async profile(userId: string): Promise<ProfileRow> {
    const r = await this.pool.query('select * from profiles where user_id=$1', [userId]);
    if (!r.rows[0]) throw new DomainError('not_found', 'Không có hồ sơ', 404);
    return {
      userId, xp: Number(r.rows[0].xp), level: Number(r.rows[0].level),
      equipped: (r.rows[0].equipped ?? {}) as Record<string, string>,
      stats: (r.rows[0].stats ?? {}) as Record<string, number>,
    };
  }
  async setEquipped(userId: string, equipped: Record<string, string>): Promise<void> {
    await this.pool.query('update profiles set equipped=$2, updated_at=now() where user_id=$1', [userId, JSON.stringify(equipped)]);
  }

  async purchaseProduct(userId: string, product: StoreProduct, key: string, makeInstance: (item: string) => SkinInstanceRow): Promise<PurchaseProductResult> {
    return this.tx(async (c) => {
      await c.query('select id from users where id=$1 for update', [userId]);
      const prior = await c.query('select instance_ids from store_purchases where user_id=$1 and idem_key=$2', [userId, key]);
      if (prior.rows[0]) {
        const ids = prior.rows[0].instance_ids as string[];
        const r = await c.query('select * from skin_instances where id = any($1::uuid[])', [ids]);
        return { duplicated: true, granted: r.rows.map(toInstance) };
      }
      const buyer = await this.accountForUser(c, userId);
      const treasury = await this.systemAccount(c, 'treasury');
      await this.postInClient(c, {
        kind: 'store_purchase', userId, idempotencyKey: key, memo: `Mua ${product.name}`,
        entries: [{ accountId: buyer.id, delta: -product.price }, { accountId: treasury.id, delta: product.price }],
        metadata: { productId: product.id },
      });
      const granted: SkinInstanceRow[] = [];
      for (const item of product.items) {
        const inst = makeInstance(item);
        await c.query(
          'insert into skin_instances (id,owner_id,skin_def_id,pattern_seed,wear_float,acquired_at,source,listed) values ($1,$2,$3,$4,$5,$6,$7,false)',
          [inst.id, inst.ownerId, inst.skinDefId, inst.patternSeed, inst.wearFloat, inst.acquiredAt, inst.source],
        );
        granted.push(inst);
      }
      await c.query('insert into store_purchases (id,user_id,idem_key,product_id,instance_ids) values ($1,$2,$3,$4,$5)',
        [randomUUID(), userId, key, product.id, granted.map((g) => g.id)]);
      await c.query('insert into audit_log (actor_id, action, payload) values ($1,$2,$3)', [userId, 'store.purchase', JSON.stringify({ productId: product.id })]);
      return { duplicated: false, granted };
    });
  }

  async inventory(userId: string): Promise<SkinInstanceRow[]> {
    const r = await this.pool.query('select * from skin_instances where owner_id=$1 order by acquired_at desc', [userId]);
    return r.rows.map(toInstance);
  }
  async instance(id: string): Promise<SkinInstanceRow | null> {
    const r = await this.pool.query('select * from skin_instances where id=$1', [id]);
    return r.rows[0] ? toInstance(r.rows[0]) : null;
  }

  private listingView(r: QueryResultRow): MarketListingView {
    return {
      id: r.id as string, sellerId: r.seller_id as string, sellerName: r.seller_name as string,
      instanceId: r.instance_id as string, skinDefId: r.skin_def_id as string,
      patternSeed: Number(r.pattern_seed), wearFloat: Number(r.wear_float),
      price: Number(r.price), status: r.status as string, createdAt: new Date(r.created_at as string).toISOString(),
    };
  }
  private static readonly LISTING_SELECT = `
    select l.*, u.display_name as seller_name, i.skin_def_id, i.pattern_seed, i.wear_float
    from market_listings l
    join users u on u.id = l.seller_id
    join skin_instances i on i.id = l.instance_id`;

  async activeListings(limit: number): Promise<MarketListingView[]> {
    const r = await this.pool.query(`${PostgresDb.LISTING_SELECT} where l.status='active' order by l.created_at desc limit $1`, [limit]);
    return r.rows.map((x) => this.listingView(x));
  }
  async listing(id: string): Promise<MarketListingView | null> {
    const r = await this.pool.query(`${PostgresDb.LISTING_SELECT} where l.id=$1`, [id]);
    return r.rows[0] ? this.listingView(r.rows[0]) : null;
  }

  async createListing(userId: string, instanceId: string, price: number, m: { minPrice: number; maxPrice: number; maxOpen: number; lockHours: number }): Promise<MarketListingView> {
    return this.tx(async (c) => {
      if (!Number.isSafeInteger(price) || price < m.minPrice || price > m.maxPrice) throw new DomainError('invalid_price', 'Giá ngoài phạm vi');
      await c.query('select id from users where id=$1 for update', [userId]);
      const inst = await c.query('select * from skin_instances where id=$1 for update', [instanceId]);
      const row = inst.rows[0];
      if (!row || row.owner_id !== userId) throw new DomainError('not_owner', 'Không sở hữu vật phẩm', 403);
      if (row.listed) throw new DomainError('already_listed', 'Vật phẩm đang được bán', 409);
      const age = await c.query<{ hours: string }>("select extract(epoch from (now() - $1::timestamptz))/3600 as hours", [row.acquired_at]);
      if (Number(age.rows[0]?.hours ?? 0) < m.lockHours) throw new DomainError('trade_locked', 'Vật phẩm còn khoá giao dịch', 409);
      const open = await c.query<{ n: string }>("select count(*) as n from market_listings where seller_id=$1 and status='active'", [userId]);
      if (Number(open.rows[0]?.n ?? 0) >= m.maxOpen) throw new DomainError('listing_limit', 'Đã đạt giới hạn tin đăng', 409);
      const id = randomUUID();
      await c.query("insert into market_listings (id,seller_id,instance_id,price,status) values ($1,$2,$3,$4,'active')", [id, userId, instanceId, price]);
      await c.query('update skin_instances set listed=true where id=$1', [instanceId]);
      await c.query('insert into audit_log (actor_id, action, payload) values ($1,$2,$3)', [userId, 'market.list', JSON.stringify({ listingId: id, instanceId, price })]);
      const view = await c.query(`${PostgresDb.LISTING_SELECT} where l.id=$1`, [id]);
      return this.listingView(view.rows[0]!);
    });
  }

  async cancelListing(userId: string, listingId: string): Promise<void> {
    await this.tx(async (c) => {
      const l = await c.query('select * from market_listings where id=$1 for update', [listingId]);
      const row = l.rows[0];
      if (!row || row.seller_id !== userId) throw new DomainError('not_owner', 'Không sở hữu tin đăng', 403);
      if (row.status !== 'active') throw new DomainError('listing_unavailable', 'Tin đăng không còn hiệu lực', 409);
      await c.query("update market_listings set status='cancelled' where id=$1", [listingId]);
      await c.query('update skin_instances set listed=false where id=$1', [row.instance_id]);
      await c.query('insert into audit_log (actor_id, action, payload) values ($1,$2,$3)', [userId, 'market.cancel', JSON.stringify({ listingId })]);
    });
  }

  async buyListing(userId: string, listingId: string, key: string, feePercent: number): Promise<TradeView> {
    return this.tx(async (c) => {
      const prior = await c.query('select * from market_trades where buyer_id=$1 and idem_key=$2', [userId, key]);
      if (prior.rows[0]) return this.tradeView(prior.rows[0], true);
      const l = await c.query('select * from market_listings where id=$1 for update', [listingId]);
      const listing = l.rows[0];
      if (!listing || listing.status !== 'active') throw new DomainError('listing_unavailable', 'Vật phẩm không còn bán', 409);
      if (listing.seller_id === userId) throw new DomainError('own_listing', 'Không thể tự mua vật phẩm của mình', 400);
      const again = await c.query('select * from market_trades where buyer_id=$1 and idem_key=$2', [userId, key]);
      if (again.rows[0]) return this.tradeView(again.rows[0], true);
      const price = Number(listing.price);
      const fee = Math.floor((price * feePercent) / 100);
      const buyer = await this.accountForUser(c, userId);
      const seller = await this.accountForUser(c, listing.seller_id);
      const feeAcc = await this.systemAccount(c, 'fee');
      await this.postInClient(c, {
        kind: 'market_purchase', userId, idempotencyKey: key, memo: 'Mua skin trên chợ',
        entries: [
          { accountId: buyer.id, delta: -price },
          { accountId: seller.id, delta: price - fee },
          { accountId: feeAcc.id, delta: fee },
        ],
        metadata: { listingId, instanceId: listing.instance_id },
      });
      const sold = await c.query("update market_listings set status='sold', buyer_id=$2, sold_at=now() where id=$1 and status='active' returning id", [listingId, userId]);
      if (!sold.rows[0]) throw new DomainError('listing_unavailable', 'Vật phẩm vừa được bán', 409);
      await c.query('update skin_instances set owner_id=$2, listed=false where id=$1', [listing.instance_id, userId]);
      const tradeId = randomUUID();
      await c.query(
        'insert into market_trades (id,listing_id,buyer_id,seller_id,instance_id,price,fee,idem_key) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [tradeId, listingId, userId, listing.seller_id, listing.instance_id, price, fee, key],
      );
      await c.query('insert into audit_log (actor_id, action, payload) values ($1,$2,$3)', [userId, 'market.purchase', JSON.stringify({ listingId, tradeId, price, fee })]);
      const trade = await c.query('select * from market_trades where id=$1', [tradeId]);
      return this.tradeView(trade.rows[0]!, false);
    });
  }

  private tradeView(r: QueryResultRow, duplicated: boolean): TradeView {
    return {
      id: r.id as string, listingId: r.listing_id as string, buyerId: r.buyer_id as string,
      sellerId: r.seller_id as string, instanceId: r.instance_id as string,
      price: Number(r.price), fee: Number(r.fee), createdAt: new Date(r.created_at as string).toISOString(), duplicated,
    };
  }

  async balance(userId: string): Promise<number> {
    const r = await this.pool.query<{ balance: string }>('select balance::text as balance from ledger_accounts where owner_id=$1', [userId]);
    if (!r.rows[0]) throw new DomainError('account_missing', 'Tài khoản Credits không tồn tại', 404);
    return Number(r.rows[0].balance);
  }

  async ledger(userId: string, limit: number): Promise<LedgerView[]> {
    const txs = await this.pool.query(
      'select id, kind, memo, created_at from ledger_transactions where user_id=$1 order by created_at desc limit $2',
      [userId, limit],
    );
    const out: LedgerView[] = [];
    for (const tx of txs.rows) {
      const entries = await this.pool.query('select account_id, delta from ledger_entries where tx_id=$1 order by id', [tx.id]);
      out.push({
        id: tx.id as string, kind: tx.kind as string, memo: tx.memo as string,
        createdAt: new Date(tx.created_at as string).toISOString(),
        entries: entries.rows.map((e) => ({ accountId: e.account_id as string, delta: Number(e.delta) })),
      });
    }
    return out;
  }

  async leaderboard(limit: number): Promise<{ userId: string; username: string; credits: number; level: number }[]> {
    const r = await this.pool.query(`
      select u.id as user_id, u.display_name as username, a.balance::text as credits, p.level
      from users u join ledger_accounts a on a.owner_id=u.id join profiles p on p.user_id=u.id
      where u.banned=false order by a.balance desc limit $1`, [limit]);
    return r.rows.map((x) => ({ userId: x.user_id as string, username: x.username as string, credits: Number(x.credits), level: Number(x.level) }));
  }

  async audit(actorId: string | null, action: string, payload: Record<string, unknown>): Promise<void> {
    await this.pool.query('insert into audit_log (actor_id, action, payload) values ($1,$2,$3)', [actorId, action, JSON.stringify(payload)]);
  }
}

