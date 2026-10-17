import { randomUUID } from 'node:crypto';
import {
  DomainError, postLedger, purchaseListing,
  type AccountRow, type LedgerTx,
  type ListingRow, type MarketRepo, type MarketTx, type PostingInput, type PostingResult, type TradeRow,
} from './domain';
import type {
  LedgerView, MarketListingView, ProfileRow, PurchaseProductResult, RefreshRow, SkinInstanceRow,
  StoreDb, StoreProduct, TradeView, UserRow,
} from './types';

interface TxRec { id: string; kind: string; userId: string; key: string; memo: string; createdAt: string; entries: { accountId: string; delta: number }[] }

export class MemoryDb implements StoreDb {
  readonly kind = 'memory' as const;
  private users = new Map<string, UserRow>();
  private byName = new Map<string, string>();
  private refresh = new Map<string, RefreshRow>();
  private accounts = new Map<string, AccountRow>();
  private accountByUser = new Map<string, string>();
  private system = new Map<string, string>();
  private postings = new Map<string, TxRec>();
  private postingByKey = new Map<string, string>();
  private instances = new Map<string, SkinInstanceRow>();
  private listings = new Map<string, ListingRow>();
  private trades = new Map<string, TradeRow & { idempotencyKey: string }>();
  private profiles = new Map<string, ProfileRow>();
  private grants = new Map<string, string[]>();
  private audits: { actorId: string | null; action: string; payload: Record<string, unknown>; at: string }[] = [];
  private chain: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    for (const kind of ['treasury', 'fee', 'escrow'] as const) {
      const id = `system_${kind}`;
      this.accounts.set(id, { id, kind, ownerId: null, balance: 0, allowNegative: true });
      this.system.set(kind, id);
    }
  }
  async close(): Promise<void> { /* không cần */ }

  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise((r) => { release = r; });
    await prev;
    try { return await fn(); } finally { release(); }
  }

  private userRow(u: UserRow): UserRow { return { ...u }; }

  async createUser(username: string, displayName: string, passwordHash: string, startCredits: number): Promise<UserRow> {
    return this.lock(async () => {
      const key = username.toLowerCase();
      if (this.byName.has(key)) throw new DomainError('conflict', 'Tên đăng nhập đã tồn tại', 409);
      const user: UserRow = {
        id: randomUUID(), username, displayName, passwordHash,
        createdAt: new Date().toISOString(), lastLoginAt: null, banned: false,
      };
      this.users.set(user.id, user);
      this.byName.set(key, user.id);
      const acc: AccountRow = { id: randomUUID(), kind: 'user', ownerId: user.id, balance: 0, allowNegative: false };
      this.accounts.set(acc.id, acc);
      this.accountByUser.set(user.id, acc.id);
      this.profiles.set(user.id, { userId: user.id, xp: 0, level: 1, equipped: {}, stats: {} });
      await this.postLedgerInternal({
        kind: 'account_start', userId: user.id, idempotencyKey: `start_${user.id}`,
        memo: 'Credits khởi tạo tài khoản',
        entries: [
          { accountId: this.system.get('treasury')!, delta: -startCredits },
          { accountId: acc.id, delta: startCredits },
        ],
      });
      return this.userRow(user);
    });
  }

  async userByName(username: string): Promise<UserRow | null> {
    const id = this.byName.get(username.toLowerCase());
    const u = id ? this.users.get(id) : null;
    return u ? this.userRow(u) : null;
  }
  async userById(id: string): Promise<UserRow | null> {
    const u = this.users.get(id);
    return u ? this.userRow(u) : null;
  }
  async markLogin(id: string): Promise<void> {
    const u = this.users.get(id);
    if (u) u.lastLoginAt = new Date().toISOString();
  }

  async saveRefresh(row: RefreshRow): Promise<void> { this.refresh.set(row.tokenHash, { ...row }); }
  async refreshByHash(hash: string): Promise<RefreshRow | null> {
    const r = this.refresh.get(hash);
    return r ? { ...r } : null;
  }
  async revokeRefresh(id: string): Promise<void> {
    for (const r of this.refresh.values()) if (r.id === id) r.revokedAt = new Date().toISOString();
  }
  async revokeFamily(familyId: string): Promise<void> {
    for (const r of this.refresh.values()) if (r.familyId === familyId && !r.revokedAt) r.revokedAt = new Date().toISOString();
  }

  async profile(userId: string): Promise<ProfileRow> {
    const p = this.profiles.get(userId);
    if (!p) throw new DomainError('account_missing', 'Không có hồ sơ', 404);
    return { ...p, equipped: { ...p.equipped }, stats: { ...p.stats } };
  }
  async setEquipped(userId: string, equipped: Record<string, string>): Promise<void> {
    const p = this.profiles.get(userId);
    if (p) p.equipped = { ...equipped };
  }

  // ----- Ledger -----
  async run<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
    return this.lock(() => fn(this.asLedgerTx()));
  }
  /** Test seam: chỉ để unit test gọi postLedger trực tiếp. */
  asLedgerTxForTest(): LedgerTx { return this.asLedgerTx(); }

  private asLedgerTx(): LedgerTx {
    return {
      findIdempotent: (u, k, kind) => this.findIdempotent(u, k, kind),
      lockAccounts: async (ids) => ids.map((id) => this.accounts.get(id)).filter((a): a is AccountRow => !!a).map((a) => ({ ...a })),
      insertPosting: (input) => this.postLedgerInternal(input),
      accountForUser: (u) => this.accountForUser(u),
      systemAccount: (kind) => this.systemAccount(kind),
    };
  }
  private findIdempotent(userId: string, key: string, kind: string): Promise<PostingResult | null> {
    const txId = this.postingByKey.get(`${userId}|${kind}|${key}`);
    return Promise.resolve(txId ? { txId, duplicated: true } : null);
  }
  async accountForUser(userId: string): Promise<AccountRow> {
    const id = this.accountByUser.get(userId);
    const acc = id ? this.accounts.get(id) : null;
    if (!acc) throw new DomainError('account_missing', 'Tài khoản Credits không tồn tại', 404);
    return { ...acc };
  }
  async systemAccount(kind: 'treasury' | 'fee' | 'escrow'): Promise<AccountRow> {
    const id = this.system.get(kind);
    const acc = id ? this.accounts.get(id) : null;
    if (!acc) throw new DomainError('account_missing', 'Tài khoản hệ thống không tồn tại');
    return { ...acc };
  }
  private async postLedgerInternal(input: PostingInput): Promise<PostingResult> {
    const dup = await this.findIdempotent(input.userId, input.idempotencyKey, input.kind);
    if (dup) return dup;
    const ids = [...new Set(input.entries.map((e) => e.accountId))];
    const accounts = ids.map((id) => this.accounts.get(id)).filter((a): a is AccountRow => !!a);
    if (accounts.length !== ids.length) throw new DomainError('account_missing', 'Tài khoản không tồn tại');
    let sum = 0;
    for (const e of input.entries) {
      if (!Number.isSafeInteger(e.delta) || e.delta === 0) throw new DomainError('invalid_posting', 'Bút toán không hợp lệ');
      sum += e.delta;
    }
    if (sum !== 0) throw new DomainError('invalid_posting', 'Tổng bút toán phải bằng 0');
    for (const e of input.entries) {
      const acc = accounts.find((a) => a.id === e.accountId)!;
      if (!acc.allowNegative && acc.balance + e.delta < 0) throw new DomainError('insufficient_funds', 'Không đủ Credits', 409);
    }
    const rec: TxRec = {
      id: randomUUID(), kind: input.kind, userId: input.userId, key: input.idempotencyKey,
      memo: input.memo, createdAt: new Date().toISOString(), entries: input.entries.map((e) => ({ ...e })),
    };
    for (const e of input.entries) {
      const acc = this.accounts.get(e.accountId)!;
      acc.balance += e.delta;
    }
    this.postings.set(rec.id, rec);
    this.postingByKey.set(`${input.userId}|${input.kind}|${input.idempotencyKey}`, rec.id);
    return { txId: rec.id, duplicated: false };
  }

  async history(userId: string, limit: number): Promise<LedgerView[]> {
    const out: LedgerView[] = [];
    for (const rec of [...this.postings.values()].reverse()) {
      if (rec.userId !== userId) continue;
      out.push({ id: rec.id, kind: rec.kind, memo: rec.memo, createdAt: rec.createdAt, entries: rec.entries });
      if (out.length >= limit) break;
    }
    return out;
  }
  async ledger(userId: string, limit: number): Promise<LedgerView[]> { return this.history(userId, limit); }

  async balance(userId: string): Promise<number> {
    const acc = await this.accountForUser(userId);
    return acc.balance;
  }

  // ----- Store -----
  async purchaseProduct(userId: string, product: StoreProduct, key: string, makeInstance: (item: string) => SkinInstanceRow): Promise<PurchaseProductResult> {
    return this.lock(async () => {
      const existing = this.grants.get(`${userId}|${key}`);
      if (existing) {
        return { duplicated: true, granted: existing.map((id) => this.instances.get(id)).filter((x): x is SkinInstanceRow => !!x) };
      }
      if (product.type === 'loot_box') throw new DomainError('feature_disabled', 'Loot box đang tắt', 403);
      const buyer = await this.accountForUser(userId);
      await postLedger(this.asLedgerTx(), {
        kind: 'store_purchase', userId, idempotencyKey: key, memo: `Mua ${product.name}`,
        entries: [
          { accountId: buyer.id, delta: -product.price },
          { accountId: this.system.get('treasury')!, delta: product.price },
        ],
      });
      const granted: SkinInstanceRow[] = [];
      for (const item of product.items) {
        const inst = makeInstance(item);
        this.instances.set(inst.id, inst);
        granted.push(inst);
      }
      this.grants.set(`${userId}|${key}`, granted.map((g) => g.id));
      this.auditList(userId, 'store.purchase', { productId: product.id, price: product.price });
      return { duplicated: false, granted };
    });
  }

  /** Chỉ dùng cho test/seed: thêm vật phẩm với thời điểm nhận tuỳ ý. */
  seedInstance(row: SkinInstanceRow): void { this.instances.set(row.id, { ...row }); }

  async inventory(userId: string): Promise<SkinInstanceRow[]> {
    return [...this.instances.values()].filter((i) => i.ownerId === userId).map((i) => ({ ...i }));
  }
  async instance(id: string): Promise<SkinInstanceRow | null> {
    const i = this.instances.get(id);
    return i ? { ...i } : null;
  }

  private listingView(l: ListingRow): MarketListingView {
    const inst = this.instances.get(l.instanceId);
    const seller = this.users.get(l.sellerId);
    return {
      id: l.id, sellerId: l.sellerId, sellerName: seller?.displayName ?? 'Unknown',
      instanceId: l.instanceId, skinDefId: inst?.skinDefId ?? l.skinDefId,
      patternSeed: inst?.patternSeed ?? 0, wearFloat: inst?.wearFloat ?? 0,
      price: l.price, status: l.status, createdAt: l.createdAt,
    };
  }

  async activeListings(limit: number): Promise<MarketListingView[]> {
    return [...this.listings.values()].filter((l) => l.status === 'active').slice(0, limit).map((l) => this.listingView(l));
  }
  async listing(id: string): Promise<MarketListingView | null> {
    const l = this.listings.get(id);
    return l ? this.listingView(l) : null;
  }

  async createListing(userId: string, instanceId: string, price: number, m: { minPrice: number; maxPrice: number; maxOpen: number; lockHours: number }): Promise<MarketListingView> {
    return this.lock(async () => {
      if (!Number.isSafeInteger(price) || price < m.minPrice || price > m.maxPrice) throw new DomainError('invalid_price', 'Giá ngoài phạm vi');
      const inst = this.instances.get(instanceId);
      if (!inst || inst.ownerId !== userId) throw new DomainError('not_owner', 'Không sở hữu vật phẩm', 403);
      if (inst.listed) throw new DomainError('already_listed', 'Vật phẩm đang được bán', 409);
      if (Date.now() - Date.parse(inst.acquiredAt) < m.lockHours * 3600_000) throw new DomainError('trade_locked', 'Vật phẩm còn khoá giao dịch', 409);
      const open = [...this.listings.values()].filter((l) => l.sellerId === userId && l.status === 'active').length;
      if (open >= m.maxOpen) throw new DomainError('listing_limit', 'Đã đạt giới hạn tin đăng', 409);
      const row: ListingRow = {
        id: randomUUID(), sellerId: userId, instanceId, skinDefId: inst.skinDefId,
        price, status: 'active', createdAt: new Date().toISOString(),
      };
      this.listings.set(row.id, row);
      inst.listed = true;
      this.auditList(userId, 'market.list', { listingId: row.id, instanceId, price });
      return this.listingView(row);
    });
  }

  async cancelListing(userId: string, listingId: string): Promise<void> {
    return this.lock(async () => {
      const l = this.listings.get(listingId);
      if (!l || l.sellerId !== userId) throw new DomainError('not_owner', 'Không sở hữu tin đăng', 403);
      if (l.status !== 'active') throw new DomainError('listing_unavailable', 'Tin đăng không còn hiệu lực', 409);
      l.status = 'cancelled';
      const inst = this.instances.get(l.instanceId);
      if (inst) inst.listed = false;
      this.auditList(userId, 'market.cancel', { listingId });
    });
  }

  async buyListing(userId: string, listingId: string, key: string, feePercent: number): Promise<TradeView> {
    return this.lock(async () => {
      const market: MarketRepo = { run: (fn) => fn(this.asMarketTx()) };
      const r = await purchaseListing(market, userId, listingId, key, feePercent);
      return { id: r.tradeId, listingId: r.listingId, buyerId: userId, sellerId: this.listings.get(listingId)?.sellerId ?? '', instanceId: r.instanceId, price: r.price, fee: r.fee, createdAt: new Date().toISOString(), duplicated: r.duplicated };
    });
  }

  private asMarketTx(): MarketTx {
    return {
      ...this.asLedgerTx(),
      lockListing: async (id) => {
        const l = this.listings.get(id);
        return l ? { ...l } : null;
      },
      findTradeByKey: async (buyerId, key) => {
        for (const t of this.trades.values()) if (t.buyerId === buyerId && t.idempotencyKey === key) return { ...t };
        return null;
      },
      markSold: async (listingId, buyerId) => {
        const l = this.listings.get(listingId);
        if (!l || l.status !== 'active') return false;
        l.status = 'sold';
        const inst = this.instances.get(l.instanceId);
        if (inst) inst.listed = false;
        void buyerId;
        return true;
      },
      transferInstance: async (instanceId, toUserId) => {
        const inst = this.instances.get(instanceId);
        if (!inst) return false;
        inst.ownerId = toUserId;
        return true;
      },
      insertTrade: async (row) => { this.trades.set(row.id, { ...row }); },
      audit: async (actorId, action, payload) => { this.auditList(actorId, action, payload); },
    };
  }

  private auditList(actorId: string | null, action: string, payload: Record<string, unknown>): void {
    this.audits.push({ actorId, action, payload, at: new Date().toISOString() });
    if (this.audits.length > 10_000) this.audits.splice(0, 1000);
  }
  async audit(actorId: string | null, action: string, payload: Record<string, unknown>): Promise<void> { this.auditList(actorId, action, payload); }

  async leaderboard(limit: number): Promise<{ userId: string; username: string; credits: number; level: number }[]> {
    const rows: { userId: string; username: string; credits: number; level: number }[] = [];
    for (const u of this.users.values()) {
      const credits = this.accounts.get(this.accountByUser.get(u.id) ?? '')?.balance ?? 0;
      rows.push({ userId: u.id, username: u.displayName, credits, level: this.profiles.get(u.id)?.level ?? 1 });
    }
    return rows.sort((a, b) => b.credits - a.credits).slice(0, limit);
  }
}

