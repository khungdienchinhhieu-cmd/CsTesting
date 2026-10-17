import { jwtVerify, type JWTPayload } from 'jose';
import type { ServerConfig } from './config';

export interface AuthedUser {
  id: string;
  name: string;
  guest: boolean;
}

export class TokenVerifier {
  private readonly secret: Uint8Array;
  constructor(private readonly cfg: ServerConfig) {
    this.secret = new TextEncoder().encode(cfg.JWT_ACCESS_SECRET);
  }

  async verify(token: string | undefined): Promise<AuthedUser | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.cfg.JWT_ISSUER,
        audience: this.cfg.JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
      return this.fromPayload(payload);
    } catch {
      return null;
    }
  }

  private fromPayload(payload: JWTPayload): AuthedUser | null {
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!sub) return null;
    const name = typeof payload.name === 'string' ? payload.name.slice(0, 16) : 'Operator';
    const guest = payload.guest === true;
    return { id: sub, name, guest };
  }
}
