import { describe, expect, it } from 'vitest';
import { createPlayerState, NavGrid, stepMovement, type GameData, type GameMap } from '@tactical/shared';
import { makeInput, testData, testMap } from '../helpers';

function setup(team: 'T' | 'CT' = 'T') {
  const data = testData();
  const map = testMap();
  const p = createPlayerState(0, 'tester', team, false, data);
  const spawn = map.spawn(team, 0);
  p.x = spawn[0]; p.y = spawn[1]; p.z = spawn[2];
  p.eyeY = p.y + data.gameplay.movement.standEye;
  const ctx = { world: map.collision, move: data.gameplay.movement, data };
  const step = (input: ReturnType<typeof makeInput>, frozen = false) => stepMovement(p, input, 1 / 64, ctx, frozen);
  return { data, map, p, step };
}

describe('di chuyển kiểu Source', () => {
  it('chạy tiến 1 giây thì đi được quãng đường hợp lý và không xuyên tường', () => {
    const { p, map, step } = setup();
    const startX = p.x, startZ = p.z;
    let seq = 0;
    // T spawn nhìn về +Z (giữa map)
    for (let i = 0; i < 64; i++) step(makeInput(++seq, { forward: 1, yaw: Math.PI / 2 }));
    const dist = Math.hypot(p.x - startX, p.z - startZ);
    expect(dist).toBeGreaterThan(3);
    expect(dist).toBeLessThan(7);
    expect(map.isWalkableWorld(p.x, p.z)).toBe(true);
    expect(p.y).toBeCloseTo(0, 1);
  });

  it('không đi xuyên tường khi lao vào tường', () => {
    const { p, map, step } = setup();
    p.x = -50.5; p.z = 0; p.y = 0; p.yaw = -Math.PI / 2;
    let seq = 0;
    for (let i = 0; i < 200; i++) step(makeInput(++seq, { forward: 1, yaw: -Math.PI / 2 }));
    expect(p.x).toBeGreaterThan(-53);
    expect(map.collision.pointInsideSolid(p.x, p.y + 0.9, p.z)).toBe(false);
  });

  it('nhảy lên rồi tiếp đất', () => {
    const { p, step } = setup();
    let seq = 0;
    step(makeInput(++seq, { buttons: 2 }));
    let maxY = 0;
    for (let i = 0; i < 80; i++) {
      step(makeInput(++seq));
      maxY = Math.max(maxY, p.y);
    }
    expect(maxY).toBeGreaterThan(0.5);
    expect(p.y).toBeCloseTo(0, 1);
    expect(p.grounded).toBe(true);
  });

  it('ngồi làm giảm tốc độ và hạ mắt', () => {
    const { p, data, step } = setup();
    let seq = 0;
    for (let i = 0; i < 64; i++) step(makeInput(++seq, { forward: 1, yaw: Math.PI / 2, buttons: 4 }));
    expect(p.crouching).toBe(true);
    expect(p.eyeY).toBeLessThan(p.y + data.gameplay.movement.standEye);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(2.2);
  });

  it('bị đóng băng thì không di chuyển', () => {
    const { p, step } = setup();
    const x = p.x, z = p.z;
    let seq = 0;
    for (let i = 0; i < 32; i++) step(makeInput(++seq, { forward: 1, yaw: Math.PI / 2 }), true);
    expect(p.x).toBe(x);
    expect(p.z).toBe(z);
  });
});

describe('navmesh', () => {
  it('tìm được đường từ spawn T tới cả hai site', () => {
    const data: GameData = testData();
    void data;
    const map: GameMap = testMap();
    const nav = new NavGrid(map);
    for (const target of [[8, -34], [7, 36]] as const) {
      const path: { x: number; y: number; z: number }[] = [];
      const n = nav.findPath(-41.5, 0, target[0], target[1], path);
      expect(n).toBeGreaterThan(2);
      const last = path[path.length - 1]!;
      expect(Math.hypot(last.x - target[0], last.z - target[1])).toBeLessThan(5);
      for (const point of path) expect(map.isWalkableWorld(point.x, point.z)).toBe(true);
    }
  });
});
