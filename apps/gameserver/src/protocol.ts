import { z } from 'zod';

export const ClientHello = z.object({
  t: z.literal('hello'),
  token: z.string().max(4096).optional(),
  name: z.string().min(1).max(16).optional(),
  mode: z.enum(['competitive', 'quick', 'deathmatch', 'custom']).default('competitive'),
  mapId: z.enum(['sandstorm', 'warehouse', 'range']).default('sandstorm'),
  team: z.enum(['T', 'CT', 'auto']).default('auto'),
  botsPerSide: z.number().int().min(0).max(5).default(0),
  tier: z.string().max(16).default('regular'),
  roomCode: z.string().max(8).optional(),
  roundsToWin: z.number().int().min(1).max(30).optional(),
  maxRounds: z.number().int().min(1).max(60).optional(),
  spectate: z.boolean().default(false),
});

export const ClientInput = z.object({
  t: z.literal('input'),
  seq: z.number().int().nonnegative(),
  forward: z.number().finite().min(-1).max(1),
  right: z.number().finite().min(-1).max(1),
  yaw: z.number().finite(),
  pitch: z.number().finite(),
  buttons: z.number().int().nonnegative().max(0xffff),
  grenadeSlot: z.number().int().min(0).max(4),
  viewTick: z.number().int().optional(),
});

export const ClientBuy = z.object({ t: z.literal('buy'), item: z.string().min(1).max(32) });
export const ClientChat = z.object({ t: z.literal('chat'), text: z.string().min(1).max(120), teamOnly: z.boolean().default(false) });
export const ClientPing = z.object({ t: z.literal('ping'), clientTime: z.number().finite() });
export const ClientLeave = z.object({ t: z.literal('leave') });
export const ClientSpectate = z.object({ t: z.literal('spectate'), target: z.number().int().min(0).max(9) });

export const ClientMessage = z.discriminatedUnion('t', [
  ClientHello, ClientInput, ClientBuy, ClientChat, ClientPing, ClientLeave, ClientSpectate,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

export interface ServerRosterEntry {
  id: number; name: string; team: 'T' | 'CT'; bot: boolean; tier: string; role: string;
}

export type ServerMessage =
  | { t: 'welcome'; roomId: string; code: string; youId: number; spectator: boolean; roster: ServerRosterEntry[]; mapId: string; mode: string; tick: number; serverTime: number; tickRate: number }
  | { t: 'roster'; roster: ServerRosterEntry[] }
  | { t: 'buy_result'; ok: boolean; itemId: string; reason?: string }
  | { t: 'chat'; from: string; team: 'T' | 'CT' | 'all'; text: string; bot: boolean; tick: number }
  | { t: 'kill'; attacker: string; victim: string; weapon: string; headshot: boolean; bot: boolean; tick: number }
  | { t: 'match_end'; winner: 'T' | 'CT' | 'draw'; scoreT: number; scoreCT: number }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'error'; code: string; message: string };
