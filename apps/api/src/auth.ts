import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { ApiConfig } from './config';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: 64 * 1024 * 1024 });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface AccessClaims { sub: string; name: string; guest: boolean; jti: string; exp: number }

export async function signAccess(cfg: ApiConfig, claims: Omit<AccessClaims, 'jti' | 'exp'>): Promise<string> {
  return new SignJWT({ name: claims.name, guest: claims.guest })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setJti(randomUUID())
    .setSubject(claims.sub)
    .setIssuer(cfg.JWT_ISSUER)
    .setAudience(cfg.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + cfg.ACCESS_TTL_SEC)
    .sign(new TextEncoder().encode(cfg.JWT_ACCESS_SECRET));
}

export async function verifyAccess(cfg: ApiConfig, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(cfg.JWT_ACCESS_SECRET), {
      issuer: cfg.JWT_ISSUER, audience: cfg.JWT_AUDIENCE, algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      name: typeof payload.name === 'string' ? payload.name : 'Operator',
      guest: payload.guest === true,
      jti: typeof payload.jti === 'string' ? payload.jti : '',
      exp: typeof payload.exp === 'number' ? payload.exp : 0,
    };
  } catch {
    return null;
  }
}

export function makeRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: createHash('sha256').update(raw).digest('hex') };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function passwordProblems(password: string): string | null {
  if (password.length < 10) return 'Mật khẩu phải có ít nhất 10 ký tự';
  if (password.length > 200) return 'Mật khẩu quá dài';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'Mật khẩu phải có chữ và số';
  return null;
}

/** Giới hạn thô tốc độ đăng nhập theo IP để chống dò mật khẩu. */
export class LoginThrottle {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly limit = 10, private readonly windowMs = 60_000) {}
  check(key: string): boolean {
    const now = Date.now();
    const row = this.attempts.get(key);
    if (!row || row.resetAt < now) { this.attempts.set(key, { count: 1, resetAt: now + this.windowMs }); return true; }
    row.count++;
    return row.count <= this.limit;
  }
  clear(key: string): void { this.attempts.delete(key); }
}
