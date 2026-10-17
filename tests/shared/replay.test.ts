import { describe, expect, it } from 'vitest';
import {
  REPLAY_VERSION, ReplayRecorder, createReplayMeta, decodeReplay, decodeReplayRow, encodeReplay,
  type InputCommand, type MatchConfig,
} from '@tactical/shared';

const config: MatchConfig = {
  mode: 'competitive', mapId: 'sandstorm', roundsToWin: 13, maxRounds: 24,
  freezeTimeSec: 15, roundTimeSec: 115, overtimeEnabled: true, botFill: false,
  infiniteMoney: false, friendlyFire: false,
};

function cmd(overrides: Partial<InputCommand> = {}): InputCommand {
  return { seq: 1, tick: 10, dt: 1 / 64, forward: 0.5, right: -0.25, yaw: 1.2345, pitch: -0.2, buttons: 3, grenadeSlot: 1, ...overrides };
}

function makeRecorder(): ReplayRecorder {
  return new ReplayRecorder(createReplayMeta({
    mapId: 'sandstorm', mode: 'competitive', config, seed: 42, youId: 0,
    players: [
      { id: 0, name: 'Operator', team: 'T', isBot: false },
      { id: 1, name: 'BOT Rook', team: 'T', isBot: true, tier: 'pro', role: 'entry' },
      { id: 2, name: 'BOT Vane', team: 'CT', isBot: true, tier: 'pro', role: 'anchor' },
    ],
  }));
}

describe('replay', () => {
  it('ghi và đọc lại input với sai số làm tròn nhỏ', () => {
    const rec = makeRecorder();
    rec.recordInput(10, cmd());
    rec.recordInput(11, cmd({ seq: 2, forward: -1, yaw: -3.1, buttons: 0 }));
    const data = rec.finish(12);
    expect(data.meta.v).toBe(REPLAY_VERSION);
    expect(data.meta.endTick).toBe(12);
    const decoded = decodeReplay(encodeReplay(data));
    expect(decoded.rows).toHaveLength(2);
    const first = decodeReplayRow(decoded.rows[0]!);
    expect(first.tick).toBe(10);
    expect(first.cmd.forward).toBeCloseTo(0.5, 2);
    expect(first.cmd.yaw).toBeCloseTo(1.2345, 3);
    expect(first.cmd.buttons).toBe(3);
    const second = decodeReplayRow(decoded.rows[1]!);
    expect(second.cmd.forward).toBe(-1);
  });

  it('từ chối dữ liệu hỏng hoặc sai phiên bản', () => {
    expect(() => decodeReplay('không phải json')).toThrow(/JSON/);
    expect(() => decodeReplay(JSON.stringify({ meta: { v: 999, mapId: 'sandstorm', players: [{}] }, rows: [] }))).toThrow(/phiên bản/);
    expect(() => decodeReplay(JSON.stringify({ meta: { v: 1, mapId: 'sandstorm', players: [] }, rows: [] }))).toThrow(/thiếu thông tin/);
    expect(() => decodeReplayRow([1, 2, 3])).toThrow(/độ dài/);
  });

  it('giới hạn 10 người chơi trong metadata', () => {
    const players = Array.from({ length: 14 }, (_, i) => ({ id: i, name: `P${i}`, team: (i % 2 ? 'CT' : 'T') as 'T' | 'CT', isBot: true }));
    const meta = createReplayMeta({ mapId: 'sandstorm', mode: 'quick', config, seed: 1, youId: 0, players });
    expect(meta.players).toHaveLength(10);
  });
});
