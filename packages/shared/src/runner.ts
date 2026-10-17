// Điều phối mô phỏng dùng chung cho offline worker, gameserver và test.
import type { BotCommand, BotConfigFile, BotSensorView } from './bot-api';
import { BotViewBuilder, type BotRosterEntry } from './bot-view';
import type { GameData } from './data';
import type { GameMap } from './map';
import type { MatchSim } from './match';
import { TICK_RATE } from './constants';
import { Rng } from './rng';
import type { GameEvent, InputCommand } from './types';

export interface BotDriver {
  think(view: BotSensorView): BotCommand;
}

export class SimHost {
  readonly sim: MatchSim;
  private readonly builder: BotViewBuilder;
  private readonly drivers = new Map<number, BotDriver>();
  private readonly roster = new Map<number, BotRosterEntry>();
  private readonly botSeq = new Map<number, number>();
  private readonly lastCmd = new Map<number, BotCommand>();
  private recentEvents: GameEvent[] = [];
  private lastThinkTick = new Map<number, number>();

  constructor(
    sim: MatchSim, data: GameData, map: GameMap, botConfig: BotConfigFile,
    entries: { id: number; name: string; tier: string; role: string; driver: BotDriver }[],
  ) {
    this.sim = sim;
    const viewRng = new Rng(sim.seed ^ 0x51ed270b);
    this.builder = new BotViewBuilder(sim, data, map, botConfig, () => viewRng.nextFloat());
    for (const e of entries) {
      this.drivers.set(e.id, e.driver);
      this.roster.set(e.id, { id: e.id, name: e.name, tier: e.tier, role: e.role });
      this.botSeq.set(e.id, 0);
    }
  }

  addDriver(entry: { id: number; name: string; tier: string; role: string; driver: BotDriver }): void {
    this.drivers.set(entry.id, entry.driver);
    this.roster.set(entry.id, { id: entry.id, name: entry.name, tier: entry.tier, role: entry.role });
    this.botSeq.set(entry.id, 0);
    this.lastCmd.delete(entry.id);
  }

  removeDriver(id: number): void {
    this.drivers.delete(id);
    this.roster.delete(id);
    this.botSeq.delete(id);
    this.lastCmd.delete(id);
  }

  submitHumanInput(id: number, cmd: InputCommand): void {
    this.sim.submitInput(id, cmd);
  }

  step(): GameEvent[] {
    const tick = this.sim.tick;
    for (const [id, driver] of this.drivers) {
      const p = this.sim.getPlayer(id);
      if (!p || !p.alive || !p.connected) continue;
      const interval = Math.max(1, Math.round(TICK_RATE / 10));
      const due = (tick + id * 2) % interval === 0;
      if (due) {
        const view = this.builder.build(p, this.roster, this.recentEvents, []);
        const cmd = driver.think(view);
        this.lastCmd.set(id, cmd);
        this.lastThinkTick.set(id, tick);
        if (cmd.buyItem) {
          this.sim.buy(id, cmd.buyItem);
        }
      }
      const cmd = this.lastCmd.get(id);
      if (cmd) {
        const seq = (this.botSeq.get(id) ?? 0) + 1;
        this.botSeq.set(id, seq);
        const input: InputCommand = {
          seq,
          tick,
          dt: 1 / TICK_RATE,
          forward: cmd.forward,
          right: cmd.right,
          yaw: cmd.yaw,
          pitch: cmd.pitch,
          buttons: cmd.buttons,
          grenadeSlot: cmd.grenadeSlot,
          viewTick: tick,
        };
        this.sim.submitInput(id, input);
      }
    }
    const events = this.sim.step();
    if (events.length > 0) {
      for (const e of events) this.recentEvents.push(e);
      if (this.recentEvents.length > 256) this.recentEvents.splice(0, this.recentEvents.length - 256);
    }
    const cutoff = this.sim.tick - TICK_RATE * 2;
    if (this.recentEvents.length && this.recentEvents[0]!.tick < cutoff) {
      this.recentEvents = this.recentEvents.filter((e) => e.tick >= cutoff);
    }
    return events;
  }
}
