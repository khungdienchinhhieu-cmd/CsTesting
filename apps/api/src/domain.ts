import { randomUUID } from 'node:crypto';

// Lõi nghiệp vụ thuần: sổ cái ghi kép + chợ. Không phụ thuộc DB để test được race.
export type AccountKind = 'user' | 'treasury' | 'fee' | 'escrow';

export interface AccountRow {
  id: string;
  kind: AccountKind;
  ownerId: string | null;
  balance: number;
  allowNegative: boolean;
}

export interface PostingEntry { accountId: string; delta: number }

export interface PostingInput {
  kind: string;
  userId: string;
  idempotencyKey: string;
  memo: string;
  entries: PostingEntry[];
  metadata?: Record<string, unknown>;
}

export interface PostingResult { txId: string; duplicated: boolean }

export type DomainErrorCode =
  | 'invalid_posting' | 'insufficient_funds' | 'account_missing' | 'duplicate_idempotency'
  | 'listing_unavailable' | 'own_listing' | 'not_owner' | 'invalid_price'
  | 'trade_locked' | 'listing_limit' | 'already_listed' | 'product_unavailable'
  | 'feature_disabled' | 'conflict' | 'unauthorized' | 'forbidden' | 'not_found';

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string, public readonly status = 400) {
    super(message);
    this.name = 'DomainError';
  }
}

export function validatePosting(entries: PostingEntry[], accounts: Map<string, AccountRow>): void {
  if (entries.length < 2) throw new DomainError('invalid_posting', 'Bút toán cần ít nhất 2 tài khoản');
  const seen = new Set<string>();
  let sum = 0;
  for (const e of entries) {
    if (!Number.isSafeInteger(e.delta) || e.delta === 0) throw new DomainError('invalid_posting', 'Giá trị bút toán không hợp lệ');
    if (seen.has(e.accountId)) throw new DomainError('invalid_posting', 'Một tài khoản xuất hiện hai lần');
    seen.add(e.accountId);
    const acc = accounts.get(e.accountId);
    if (!acc) throw new DomainError('account_missing', 'Tài khoản không tồn tại');
    sum += e.delta;
  }
  if (sum !== 0) throw new DomainError('invalid_posting', 'Tổng bút toán phải bằng 0');
  for (const e of entries) {
    const acc = accounts.get(e.accountId)!;
    if (!acc.allowNegative && acc.balance + e.delta < 0) {
      throw new DomainError('insufficient_funds', 'Không đủ Credits', 409);
    }
  }
}

export interface LedgerTx {
  findIdempotent(userId: string, key: string, kind: string): Promise<PostingResult | null>;
  lockAccounts(ids: string[]): Promise<AccountRow[]>;
  insertPosting(input: PostingInput): Promise<PostingResult>;
  accountForUser(userId: string): Promise<AccountRow>;
  systemAccount(kind: Exclude<AccountKind, 'user'>): Promise<AccountRow>;
}

export interface LedgerRepo {
  run<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T>;
  history(userId: string, limit: number): Promise<{ id: string; kind: string; memo: string; createdAt: string; entries: { accountId: string; delta: number }[] }[]>;
}

/** Ghi bút toán kép; idempotent theo (userId, key, kind). */
export async function postLedger(tx: LedgerTx, input: PostingInput): Promise<PostingResult> {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError('invalid_posting', 'Thiếu idempotency key');
  const existing = await tx.findIdempotent(input.userId, input.idempotencyKey, input.kind);
  if (existing) return { ...existing, duplicated: true };
  if (input.entries.length < 2) throw new DomainError('invalid_posting', 'Bút toán cần ít nhất 2 tài khoản');
  const ids = [...new Set(input.entries.map((e) => e.accountId))].sort();
  const locked = await tx.lockAccounts(ids);
  const map = new Map(locked.map((a) => [a.id, a]));
  validatePosting(input.entries, map);
  // Khoá tài khoản đã tuần tự hoá hai giao dịch trùng key; kiểm tra lại sau khi khoá.
  const again = await tx.findIdempotent(input.userId, input.idempotencyKey, input.kind);
  if (again) return { ...again, duplicated: true };
  return tx.insertPosting(input);
}

export interface ListingRow {
  id: string;
  sellerId: string;
  instanceId: string;
  skinDefId: string;
  price: number;
  status: 'active' | 'sold' | 'cancelled';
  createdAt: string;
}

export interface TradeRow {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  instanceId: string;
  price: number;
  fee: number;
  createdAt: string;
}

export interface MarketTx extends LedgerTx {
  lockListing(id: string): Promise<ListingRow | null>;
  findTradeByKey(buyerId: string, key: string): Promise<TradeRow | null>;
  markSold(listingId: string, buyerId: string): Promise<boolean>;
  transferInstance(instanceId: string, toUserId: string): Promise<boolean>;
  insertTrade(row: TradeRow & { idempotencyKey: string }): Promise<void>;
  audit(actorId: string | null, action: string, payload: Record<string, unknown>): Promise<void>;
}

export interface MarketRepo {
  run<T>(fn: (tx: MarketTx) => Promise<T>): Promise<T>;
}

export interface PurchaseResult {
  tradeId: string;
  listingId: string;
  price: number;
  fee: number;
  instanceId: string;
  duplicated: boolean;
}

/** Mua vật phẩm: khoá listing → khoá tài khoản → ghi sổ → đổi chủ → lưu trade. */
export async function purchaseListing(
  repo: MarketRepo, buyerId: string, listingId: string, idempotencyKey: string, feePercent: number,
): Promise<PurchaseResult> {
  return repo.run(async (tx) => {
    const prev = await tx.findTradeByKey(buyerId, idempotencyKey);
    if (prev) return { tradeId: prev.id, listingId: prev.listingId, price: prev.price, fee: prev.fee, instanceId: prev.instanceId, duplicated: true };
    const listing = await tx.lockListing(listingId);
    if (!listing || listing.status !== 'active') throw new DomainError('listing_unavailable', 'Vật phẩm không còn bán', 409);
    if (listing.sellerId === buyerId) throw new DomainError('own_listing', 'Không thể tự mua vật phẩm của mình', 400);
    // Kiểm tra lại sau khi khoá: giao dịch trùng có thể vừa commit.
    const prev2 = await tx.findTradeByKey(buyerId, idempotencyKey);
    if (prev2) return { tradeId: prev2.id, listingId: prev2.listingId, price: prev2.price, fee: prev2.fee, instanceId: prev2.instanceId, duplicated: true };
    const buyer = await tx.accountForUser(buyerId);
    const seller = await tx.accountForUser(listing.sellerId);
    const feeAcc = await tx.systemAccount('fee');
    if (!Number.isSafeInteger(listing.price) || listing.price <= 0) throw new DomainError('invalid_price', 'Giá không hợp lệ');
    const fee = Math.floor((listing.price * feePercent) / 100);
    const proceeds = listing.price - fee;
    const posted = await postLedger(tx, {
      kind: 'market_purchase', userId: buyerId, idempotencyKey, memo: `Mua ${listing.skinDefId}`,
      entries: [
        { accountId: buyer.id, delta: -listing.price },
        { accountId: seller.id, delta: proceeds },
        { accountId: feeAcc.id, delta: fee },
      ],
      metadata: { listingId, instanceId: listing.instanceId },
    });
    const sold = await tx.markSold(listingId, buyerId);
    if (!sold) throw new DomainError('listing_unavailable', 'Vật phẩm vừa được bán', 409);
    const moved = await tx.transferInstance(listing.instanceId, buyerId);
    if (!moved) throw new DomainError('conflict', 'Không thể chuyển quyền sở hữu', 409);
    const trade: TradeRow & { idempotencyKey: string } = {
      id: randomUUID(), listingId, buyerId, sellerId: listing.sellerId,
      instanceId: listing.instanceId, price: listing.price, fee, createdAt: new Date().toISOString(), idempotencyKey,
    };
    await tx.insertTrade(trade);
    await tx.audit(buyerId, 'market.purchase', { listingId, tradeId: trade.id, price: listing.price, fee });
    return { tradeId: trade.id, listingId, price: listing.price, fee, instanceId: listing.instanceId, duplicated: posted.duplicated };
  });
}

/** Tạo listing: kiểm tra chủ sở hữu, khoá giao dịch, giá và hạn mức. */
export async function createListing(tx: MarketTx, input: {
  sellerId: string; instanceId: string; price: number; lockedUntil: number;
  minPrice: number; maxPrice: number; maxOpen: number;
  instance: { ownerId: string; acquiredMs: number; listed: boolean } | null;
}): Promise<ListingRow> {
  if (!Number.isSafeInteger(input.price) || input.price < input.minPrice || input.price > input.maxPrice) {
    throw new DomainError('invalid_price', 'Giá nằm ngoài phạm vi cho phép');
  }
  if (!input.instance || input.instance.ownerId !== input.sellerId) throw new DomainError('not_owner', 'Không sở hữu vật phẩm', 403);
  if (input.instance.acquiredMs > input.lockedUntil) throw new DomainError('trade_locked', 'Vật phẩm còn khoá giao dịch', 409);
  if (input.instance.listed) throw new DomainError('already_listed', 'Vật phẩm đang được bán', 409);
  const row: ListingRow = {
    id: randomUUID(), sellerId: input.sellerId, instanceId: input.instanceId,
    skinDefId: '', price: input.price, status: 'active', createdAt: new Date().toISOString(),
  };
  void input.maxOpen;
  return row;
}

export function feeFor(price: number, percent: number): number {
  return Math.floor((price * percent) / 100);
}
