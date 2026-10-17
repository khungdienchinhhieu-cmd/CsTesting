export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
  lastLoginAt: string | null;
  banned: boolean;
}

export interface RefreshRow {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface SkinInstanceRow {
  id: string;
  ownerId: string;
  skinDefId: string;
  patternSeed: number;
  wearFloat: number;
  acquiredAt: string;
  source: string;
  listed: boolean;
}

export interface ProfileRow {
  userId: string;
  xp: number;
  level: number;
  equipped: Record<string, string>;
  stats: Record<string, number>;
}

export interface MarketListingView {
  id: string;
  sellerId: string;
  sellerName: string;
  instanceId: string;
  skinDefId: string;
  patternSeed: number;
  wearFloat: number;
  price: number;
  status: string;
  createdAt: string;
}

export interface LedgerView {
  id: string;
  kind: string;
  memo: string;
  createdAt: string;
  entries: { accountId: string; delta: number }[];
}

export interface TradeView {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  instanceId: string;
  price: number;
  fee: number;
  createdAt: string;
  duplicated: boolean;
}

export interface StoreProduct {
  id: string;
  name: string;
  price: number;
  type: string;
  items: string[];
  badge?: string;
  credits?: number;
  note?: string;
}

export interface PurchaseProductResult {
  duplicated: boolean;
  granted: SkinInstanceRow[];
}

export interface StoreDb {
  init(): Promise<void>;
  close(): Promise<void>;
  kind: 'memory' | 'postgres';

  createUser(username: string, displayName: string, passwordHash: string, startCredits: number): Promise<UserRow>;
  userByName(username: string): Promise<UserRow | null>;
  userById(id: string): Promise<UserRow | null>;
  markLogin(id: string): Promise<void>;

  saveRefresh(row: RefreshRow): Promise<void>;
  refreshByHash(hash: string): Promise<RefreshRow | null>;
  revokeRefresh(id: string): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;

  profile(userId: string): Promise<ProfileRow>;
  setEquipped(userId: string, equipped: Record<string, string>): Promise<void>;

  purchaseProduct(userId: string, product: StoreProduct, idempotencyKey: string, makeInstance: (item: string) => SkinInstanceRow): Promise<PurchaseProductResult>;
  inventory(userId: string): Promise<SkinInstanceRow[]>;
  instance(id: string): Promise<SkinInstanceRow | null>;

  activeListings(limit: number): Promise<MarketListingView[]>;
  listing(id: string): Promise<MarketListingView | null>;
  createListing(userId: string, instanceId: string, price: number, markets: { minPrice: number; maxPrice: number; maxOpen: number; lockHours: number }): Promise<MarketListingView>;
  cancelListing(userId: string, listingId: string): Promise<void>;
  buyListing(userId: string, listingId: string, idempotencyKey: string, feePercent: number): Promise<TradeView>;

  balance(userId: string): Promise<number>;
  ledger(userId: string, limit: number): Promise<LedgerView[]>;
  leaderboard(limit: number): Promise<{ userId: string; username: string; credits: number; level: number }[]>;
  audit(actorId: string | null, action: string, payload: Record<string, unknown>): Promise<void>;
}
