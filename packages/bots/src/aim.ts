import { BOT_TICK_RATE, type BotEnemyView, type BotSelfState } from '@tactical/shared/bot-api';

export interface AimState {
  yaw: number;
  pitch: number;
  targetId: number | null;
  targetAcquiredTick: number;
  reactionUntilTick: number;
  errorYaw: number;
  errorPitch: number;
  overshootYaw: number;
  overshootPitch: number;
  lastSeenTick: number;
  aimPoint: 'head' | 'chest';
  settledTicks: number;
}

export function createAimState(yaw: number, pitch: number): AimState {
  return {
    yaw, pitch, targetId: null, targetAcquiredTick: 0, reactionUntilTick: 0,
    errorYaw: 0, errorPitch: 0, overshootYaw: 0, overshootPitch: 0,
    lastSeenTick: 0, aimPoint: 'chest', settledTicks: 0,
  };
}

export function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

export function gaussian(rng: () => number): number {
  let u = rng();
  if (u < 1e-9) u = 1e-9;
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function eyeHeight(self: BotSelfState): number {
  return self.y + (self.crouching ? 1.16 : 1.64);
}

export function targetPoint(e: BotEnemyView, point: 'head' | 'chest'): [number, number, number] {
  const h = e.crouching ? 1.16 : 1.64;
  if (point === 'head') return [e.x, e.y + h, e.z];
  return [e.x, e.y + (e.crouching ? 0.8 : 1.2), e.z];
}

/** Điểm ngắm cộng sai số người + bù giật theo pattern. */
export function computeDesiredAim(
  self: BotSelfState, target: { x: number; y: number; z: number }, _point: 'head' | 'chest',
  recoil: [number, number][], sprayControl: number,
): { yaw: number; pitch: number } {
  const ex = self.x, ey = eyeHeight(self), ez = self.z;
  // target.y đã là điểm ngắm tuyệt đối (targetPoint), không cộng chiều cao lần nữa.
  const ty = target.y;
  const dx = target.x - ex, dz = target.z - ez;
  const horiz = Math.sqrt(dx * dx + dz * dz);
  let yaw = Math.atan2(dx, dz);
  let pitch = Math.atan2(ty - ey, Math.max(0.02, horiz));
  if (self.recoilShots > 0 && recoil.length > 0) {
    const entry = recoil[Math.min(Math.max(0, self.recoilShots - 1), recoil.length - 1)]!;
    const comp = 0.35 + 0.65 * sprayControl;
    yaw -= (entry[0] * Math.PI / 180) * comp;
    pitch -= (entry[1] * Math.PI / 180) * comp;
  }
  return { yaw: wrapAngle(yaw), pitch };
}

/** Giới hạn tốc độ quay + overshoot kiểu người. */
export function stepAim(
  state: AimState, desiredYaw: number, desiredPitch: number,
  maxStepRad: number, overshootAmount: number, tick: number,
): { yaw: number; pitch: number } {
  const dYaw = wrapAngle(desiredYaw - state.yaw + state.overshootYaw);
  const dPitch = desiredPitch - state.pitch + state.overshootPitch;
  const stepYaw = Math.max(-maxStepRad, Math.min(maxStepRad, dYaw));
  const stepPitch = Math.max(-maxStepRad, Math.min(maxStepRad, dPitch));
  state.yaw = wrapAngle(state.yaw + stepYaw);
  state.pitch += stepPitch;
  state.overshootYaw *= 0.55;
  state.overshootPitch *= 0.55;
  if (Math.abs(stepYaw) > maxStepRad * 0.9) {
    state.settledTicks = 0;
  } else {
    state.settledTicks++;
  }
  void overshootAmount; void tick;
  return { yaw: state.yaw, pitch: state.pitch };
}

export function angularError(aYaw: number, aPitch: number, bYaw: number, bPitch: number): number {
  return Math.abs(wrapAngle(aYaw - bYaw)) + Math.abs(aPitch - bPitch);
}

export function reactionDelayMs(baseMs: number, sigma: number, firstSightPenalty: number, peripheral: boolean, rng: () => number): number {
  const n = Math.exp(gaussian(rng) * sigma);
  return baseMs * n * (peripheral ? firstSightPenalty : 1);
}

export function tickFromMs(ms: number): number { return Math.round((ms / 1000) * BOT_TICK_RATE); }
