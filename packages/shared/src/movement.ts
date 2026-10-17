import type { CollisionWorld } from './collision';
import type { GameData, MovementDef } from './data';
import { clamp } from './math';
import { Buttons, type InputCommand, type PlayerState } from './types';

const SUBSTEP = 0.22;

export interface MoveContext {
  world: CollisionWorld;
  move: MovementDef;
  data: GameData;
}

export function activeMoveSpeed(p: PlayerState, ctx: MoveContext): number {
  const w = ctx.data.weapon(p.activeWeapon || (p.team === 'T' ? 'pistol_t' : 'pistol_ct'));
  let speed = w.moveSpeed;
  if (w.scopedMoveSpeed && p.scoped) speed = w.scopedMoveSpeed;
  const mv = ctx.move;
  if (p.crouching) speed *= mv.crouchMultiplier;
  else if (p.walking) speed *= mv.walkMultiplier;
  return speed;
}

interface AxisResult { blocked: boolean; stepped: boolean }

function overlapAt(p: PlayerState, x: number, y: number, z: number, radius: number, height: number, world: CollisionWorld): boolean {
  return world.overlapsSolid(x - radius, y, z - radius, x + radius, y + height, z + radius);
}

function tryMoveAxis(
  p: PlayerState, axis: 'x' | 'z', amount: number, radius: number, height: number, world: CollisionWorld, canStep: boolean,
): AxisResult {
  if (Math.abs(amount) < 1e-9) return { blocked: false, stepped: false };
  let remaining = amount;
  let stepped = false;
  const dir = Math.sign(remaining);
  let guard = 0;
  while (Math.abs(remaining) > 1e-9 && guard++ < 8) {
    const step = Math.abs(remaining) > SUBSTEP ? dir * SUBSTEP : remaining;
    const nx = axis === 'x' ? p.x + step : p.x;
    const nz = axis === 'z' ? p.z + step : p.z;
    if (!overlapAt(p, nx, p.y, nz, radius, height, world)) {
      p.x = nx; p.z = nz;
      remaining -= step;
      continue;
    }
    // Thử bước lên bậc nhỏ (chỉ khi đang đứng đất và đang đi ngang).
    if (canStep && !stepped) {
      const raised = p.y + 0.351;
      if (!overlapAt(p, nx, raised, nz, radius, height, world)) {
        p.y = raised;
        p.x = nx; p.z = nz;
        stepped = true;
        remaining -= step;
        continue;
      }
      // Thử bậc thấp hơn một chút (tránh kẹt ở mép 0.35).
      const lower = p.y + 0.25;
      if (!overlapAt(p, nx, lower, nz, radius, height, world)) {
        p.y = lower;
        p.x = nx; p.z = nz;
        stepped = true;
        remaining -= step;
        continue;
      }
    }
    if (axis === 'x') p.vx = 0; else p.vz = 0;
    return { blocked: true, stepped };
  }
  return { blocked: false, stepped };
}

/** Cập nhật di chuyển 1 tick. Authoritative: chạy y hệt trên client và server. */
export function stepMovement(p: PlayerState, input: InputCommand, dt: number, ctx: MoveContext, frozen: boolean): void {
  const mv = ctx.move;
  const radius = mv.playerRadius;
  const height = p.crouching ? mv.crouchHeight : mv.standHeight;

  const fwd = input.forward;
  const right = input.right;
  const wishLen = Math.sqrt(fwd * fwd + right * right);
  let wishX = 0, wishZ = 0;
  if (wishLen > 0) {
    const inv = 1 / wishLen;
    const yaw = p.yaw;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    // forward = (sin, 0, cos), right = (cos, 0, -sin)
    wishX = (sy * fwd * inv + cy * right * inv);
    wishZ = (cy * fwd * inv - sy * right * inv);
  }
  const walk = (input.buttons & Buttons.Walk) !== 0;
  p.walking = walk;

  let maxSpeed = ctx.data.weapon(p.activeWeapon || (p.team === 'T' ? 'pistol_t' : 'pistol_ct')).moveSpeed;
  if (p.scoped) {
    const sw = ctx.data.weapons.get(p.activeWeapon);
    if (sw?.scopedMoveSpeed) maxSpeed = sw.scopedMoveSpeed;
  }
  if (p.crouching) maxSpeed *= mv.crouchMultiplier;
  else if (walk) maxSpeed *= mv.walkMultiplier;

  if (frozen) {
    p.vx = 0; p.vz = 0; p.vy = 0;
    p.grounded = true;
    p.eyeY = p.y + (p.crouching ? mv.crouchEye : mv.standEye);
    return;
  }

  // Nhảy
  const jumpDown = (input.buttons & Buttons.Jump) !== 0;
  if (jumpDown && !p.jumpWasDown && p.grounded) {
    p.vy = mv.jumpVelocity;
    p.grounded = false;
  }
  p.jumpWasDown = jumpDown;

  // Ma sát mặt đất
  if (p.grounded) {
    const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    if (speed > 0) {
      const control = speed < mv.stopSpeed ? mv.stopSpeed : speed;
      const drop = control * mv.friction * dt;
      const newSpeed = Math.max(0, speed - drop);
      const scale = newSpeed / speed;
      p.vx *= scale; p.vz *= scale;
    }
    // Tăng tốc
    if (wishLen > 0) {
      const current = p.vx * wishX + p.vz * wishZ;
      const add = maxSpeed - current;
      if (add > 0) {
        const accel = Math.min(mv.groundAccel * maxSpeed * dt, add);
        p.vx += wishX * accel; p.vz += wishZ * accel;
      }
    }
  } else if (wishLen > 0) {
    // Air control kiểu Source: wishspeed bị giới hạn, nhưng đổi hướng tự do.
    const wishSpeed = Math.min(maxSpeed, mv.airWishCap);
    const current = p.vx * wishX + p.vz * wishZ;
    const add = wishSpeed - current;
    if (add > 0) {
      const accel = Math.min(mv.airAccel * wishSpeed * dt, add);
      p.vx += wishX * accel; p.vz += wishZ * accel;
    }
  }

  // Giới hạn tốc độ ngang (bảo vệ chống input lỗi)
  const hSpeed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  const hardCap = maxSpeed * 1.65 + 1.5;
  if (hSpeed > hardCap) {
    const s = hardCap / hSpeed; p.vx *= s; p.vz *= s;
  }

  const wasGrounded = p.grounded;
  tryMoveAxis(p, 'x', p.vx * dt, radius, height, ctx.world, p.grounded);
  tryMoveAxis(p, 'z', p.vz * dt, radius, height, ctx.world, p.grounded);

  // Trọng lực + trục dọc
  p.vy = clamp(p.vy - mv.gravity * dt, -mv.maxFallSpeed, mv.maxFallSpeed);
  const previousY = p.y;
  p.y += p.vy * dt;
  if (p.vy > 0) {
    if (overlapAt(p, p.x, p.y, p.z, radius, height, ctx.world)) {
      p.y = previousY;
      p.vy = 0;
    }
    p.grounded = false;
  } else {
    const support = ctx.world.floorHeightAt(p.x, p.z, previousY + mv.stepHeight + 0.06);
    if (support > -Infinity && p.y <= support + 0.03) {
      p.y = support;
      p.vy = 0;
      p.grounded = true;
    } else {
      p.grounded = false;
      // Nếu đang đứng trên mép, cho rơi tự do.
    }
  }

  // Crouch: không cho đứng lên nếu trần thấp
  if (p.crouching) {
    const canStand = !overlapAt(p, p.x, p.y, p.z, radius, mv.standHeight, ctx.world);
    if (canStand && (input.buttons & Buttons.Crouch) === 0) p.crouching = false;
  } else if ((input.buttons & Buttons.Crouch) !== 0) {
    p.crouching = true;
  }

  // Chống teleport do kẹt: nếu rơi khỏi map
  if (p.y < -20) {
    p.y = 0; p.vy = 0;
  }

  // Ước lượng trạng thái di chuyển (dùng cho animation phía client/agent)
  const spd = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  if (!p.grounded) p.mvmtState = 'jump';
  else if (p.crouching && spd > 0.2) p.mvmtState = 'crouch';
  else if (spd > 3.3) p.mvmtState = 'run';
  else if (spd > 0.2) p.mvmtState = 'walk';
  else p.mvmtState = wasGrounded ? 'idle' : 'land';

  // Mắt: nội suy nhanh để hitbox/aim ổn định
  const eyeTarget = p.y + (p.crouching ? mv.crouchEye : mv.standEye);
  p.eyeY = eyeTarget;
}

export function eyePosition(p: PlayerState): { x: number; y: number; z: number } {
  return { x: p.x, y: p.eyeY, z: p.z };
}
