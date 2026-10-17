import {
  createPlayerState, stepMovement, type GameData, type GameMap, type InputCommand,
  type NetSelf, type PlayerState, type RoundPhase, type Team,
} from '@tactical/shared';

/** Dự đoán vị trí cục bộ + hoà giải với snapshot server (cùng stepMovement). */
export class Predictor {
  readonly state: PlayerState;
  private readonly ctx;
  pending: InputCommand[] = [];

  constructor(private readonly data: GameData, private readonly map: GameMap, team: Team) {
    this.state = createPlayerState(0, 'you', team, false, data);
    this.ctx = { world: map.collision, move: data.gameplay.movement, data };
  }

  reset(snap: NetSelf, phase: RoundPhase): void {
    const p = this.state;
    p.x = snap.x; p.y = snap.y; p.z = snap.z;
    p.vx = snap.vx; p.vy = snap.vy; p.vz = snap.vz;
    p.yaw = snap.yaw; p.pitch = snap.pitch;
    p.alive = snap.alive;
    p.crouching = snap.crouching;
    p.walking = snap.walking;
    p.grounded = snap.grounded;
    p.eyeY = snap.y + (snap.crouching ? this.data.gameplay.movement.crouchEye : this.data.gameplay.movement.standEye);
    p.activeWeapon = 'knife';
    p.health = snap.health;
    this.replay(phase);
  }

  reconcile(snap: NetSelf, phase: RoundPhase, ackSeq: number): number {
    this.pending = this.pending.filter((c) => c.seq > ackSeq);
    const beforeX = this.state.x, beforeZ = this.state.z;
    this.reset(snap, phase);
    return Math.hypot(this.state.x - beforeX, this.state.z - beforeZ);
  }

  apply(cmd: InputCommand, phase: RoundPhase): void {
    this.pending.push(cmd);
    if (this.pending.length > 24) this.pending.shift();
    this.step(cmd, phase);
  }

  private replay(phase: RoundPhase): void {
    for (const cmd of this.pending) this.step(cmd, phase);
  }

  private step(cmd: InputCommand, phase: RoundPhase): void {
    const p = this.state;
    if (!p.alive) return;
    const frozen = phase === 'freeze' || phase === 'over';
    // Chỉ mô phỏng di chuyển; vũ khí/đạn lấy từ snapshot.
    stepMovement(p, cmd, 1 / 64, this.ctx, frozen);
    p.eyeY = p.y + (p.crouching ? this.data.gameplay.movement.crouchEye : this.data.gameplay.movement.standEye);
  }

  get eye(): { x: number; y: number; z: number } {
    return { x: this.state.x, y: this.state.eyeY, z: this.state.z };
  }

  clear(): void { this.pending = []; }
}
