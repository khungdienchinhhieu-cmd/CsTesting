import { MAX_PLAYERS, SERVER_HISTORY_TICKS, TICK_RATE } from './constants';
import { rayAABB } from './math';
import type { AABB, HitboxGroup, HitboxState, PlayerId, PlayerState } from './types';

const GROUPS: HitboxGroup[] = ['head', 'chest', 'stomach', 'legs'];
const FLOATS_PER_GROUP = 6;
const STRIDE = GROUPS.length * FLOATS_PER_GROUP;

function setBox(out: AABB, cx: number, y0: number, y1: number, halfW: number, cz: number): void {
  out.minX = cx - halfW; out.maxX = cx + halfW;
  out.minY = y0; out.maxY = y1;
  out.minZ = cz - halfW; out.maxZ = cz + halfW;
}

function emptyHitbox(): HitboxState {
  const mk = (): AABB => ({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
  return { head: mk(), chest: mk(), stomach: mk(), legs: mk() };
}

/**
 * Hitbox từ trạng thái mô phỏng. Hàm thuần, chạy giống hệt client/server.
 * Hình dạng hiện là capsule xấp xỉ bằng AABB; M5 sẽ lấy thêm tư thế animation
 * nhưng vẫn dùng cùng bộ tham số để client/server khớp.
 */
export function computeHitboxes(p: PlayerState, out?: HitboxState): HitboxState {
  const h = out ?? emptyHitbox();
  const crouch = p.crouching;
  const scale = crouch ? 0.72 : 1.0;
  const baseY = p.y;
  // Các mốc theo chiều cao cơ thể (m)
  const legTop = baseY + 0.86 * scale;
  const stomachTop = baseY + 1.16 * scale;
  const chestTop = baseY + 1.52 * scale;
  const headTop = baseY + 1.8 * scale;
  const bodyHalf = 0.24;
  const headHalf = 0.13;
  // Dịch nhẹ theo hướng nhìn để cảm giác khớp mô hình
  const lean = crouch ? 0.05 : 0.02;
  const ox = Math.sin(p.yaw) * lean;
  const oz = Math.cos(p.yaw) * lean;
  const cx = p.x + ox, cz = p.z + oz;
  setBox(h.legs, cx, baseY + 0.04, legTop, bodyHalf * 0.78, cz);
  setBox(h.stomach, cx, legTop, stomachTop, bodyHalf, cz);
  setBox(h.chest, cx, stomachTop, chestTop, bodyHalf * 1.04, cz);
  setBox(h.head, cx, chestTop, headTop, headHalf, cz);
  return h;
}

export function hitboxGroupAt(
  h: HitboxState, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number,
): { group: HitboxGroup; t: number } | null {
  let bestT = maxDist, best: HitboxGroup | null = null;
  for (const g of GROUPS) {
    const b = h[g];
    if (b.maxY <= b.minY) continue;
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
    if (t >= 0 && t < bestT) { bestT = t; best = g; }
  }
  return best ? { group: best, t: bestT } : null;
}

/** Vòng đệm lịch sử hitbox cố định, không cấp phát trong lúc chơi. */
export class HitboxHistory {
  private data = new Float32Array(MAX_PLAYERS * SERVER_HISTORY_TICKS * STRIDE);
  private ticks = new Int32Array(SERVER_HISTORY_TICKS).fill(-1);
  private ids = new Int32Array(MAX_PLAYERS).fill(-1);
  private rewindOut = emptyHitbox();

  clear(): void {
    this.ticks.fill(-1);
    this.ids.fill(-1);
  }

  record(tick: number, players: readonly PlayerState[]): void {
    const slot = tick % SERVER_HISTORY_TICKS;
    this.ticks[slot] = tick;
    let i = 0;
    for (const p of players) {
      if (i >= MAX_PLAYERS) break;
      this.ids[i] = p.id;
      const base = (i * SERVER_HISTORY_TICKS + slot) * STRIDE;
      writeHitbox(this.data, base, computeHitboxes(p, this.rewindOut));
      i++;
    }
    for (; i < MAX_PLAYERS; i++) this.ids[i] = -1;
  }

  /** Lấy hitbox gần tick yêu cầu nhất (tua lại cho lag compensation). */
  getAt(playerId: PlayerId, tick: number): HitboxState | null {
    const slot = ((tick % SERVER_HISTORY_TICKS) + SERVER_HISTORY_TICKS) % SERVER_HISTORY_TICKS;
    if (this.ticks[slot] !== tick) return null;
    let pslot = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) if (this.ids[i] === playerId) { pslot = i; break; }
    if (pslot < 0) return null;
    const base = (pslot * SERVER_HISTORY_TICKS + slot) * STRIDE;
    readHitbox(this.data, base, this.rewindOut);
    return this.rewindOut;
  }

  latestTick(): number {
    let best = -1;
    for (let i = 0; i < SERVER_HISTORY_TICKS; i++) if (this.ticks[i]! > best) best = this.ticks[i]!;
    return best;
  }
}

export function hitboxToArray(h: HitboxState, out: Float32Array, offset = 0): void {
  writeHitbox(out, offset, h);
}
export function arrayToHitbox(arr: Float32Array, offset: number, out: HitboxState): HitboxState {
  readHitbox(arr, offset, out);
  return out;
}

function writeHitbox(arr: Float32Array, base: number, h: HitboxState): void {
  const groups = [h.head, h.chest, h.stomach, h.legs];
  for (let g = 0; g < groups.length; g++) {
    const b = groups[g]!;
    const o = base + g * FLOATS_PER_GROUP;
    arr[o] = b.minX; arr[o + 1] = b.minY; arr[o + 2] = b.minZ;
    arr[o + 3] = b.maxX; arr[o + 4] = b.maxY; arr[o + 5] = b.maxZ;
  }
}
function readHitbox(arr: Float32Array, base: number, h: HitboxState): void {
  const groups = [h.head, h.chest, h.stomach, h.legs];
  for (let g = 0; g < groups.length; g++) {
    const b = groups[g]!;
    const o = base + g * FLOATS_PER_GROUP;
    b.minX = arr[o]!; b.minY = arr[o + 1]!; b.minZ = arr[o + 2]!;
    b.maxX = arr[o + 3]!; b.maxY = arr[o + 4]!; b.maxZ = arr[o + 5]!;
  }
}

/** Tick mô phỏng gần nhất cho một mốc thời gian client nhìn thấy (giới hạn lag comp). */
export function rewindTickFor(inputTick: number, serverTick: number, maxLagMs = 200): number {
  const maxTicks = Math.round((maxLagMs / 1000) * TICK_RATE);
  return Math.max(serverTick - maxTicks, Math.min(serverTick, inputTick));
}
