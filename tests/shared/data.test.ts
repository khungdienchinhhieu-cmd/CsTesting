import { describe, expect, it } from 'vitest';
import { testBots, testData, testMap } from '../helpers';

describe('dữ liệu game', () => {
  it('nạp weapons/gameplay/economy hợp lệ', () => {
    const data = testData();
    expect(data.weapons.size).toBeGreaterThanOrEqual(10);
    expect(data.grenades.size).toBe(5);
    expect(data.weapon('rifle_t').damage).toBe(36);
    expect(data.weapon('rifle_t').recoil.pattern.length).toBe(30);
    expect(data.gameplay.tickRate).toBe(64);
    expect(data.economy.maxMoney).toBe(16000);
  });

  it('map sandstorm có layout nhất quán và spawn walkable', () => {
    const map = testMap();
    expect(map.width).toBe(50);
    expect(map.height).toBe(50);
    expect(map.colliders.length).toBeGreaterThan(50);
    for (const team of ['T', 'CT'] as const) {
      for (const [x, , z] of map.json.spawns[team]) {
        expect(map.isWalkableWorld(x, z)).toBe(true);
        expect(map.floorHeightAt(x, z)).toBe(0);
      }
    }
  });

  it('cấu hình bot có 5 bậc kỹ năng và tham số bắt buộc', () => {
    const bots = testBots();
    for (const tier of ['rookie', 'regular', 'veteran', 'elite', 'pro']) {
      expect(bots.tiers[tier]).toBeTruthy();
      expect(bots.tiers[tier]!.reactionMedianMs).toBeGreaterThan(100);
    }
    expect(bots.shared.thinkHz).toBe(10);
  });
});
