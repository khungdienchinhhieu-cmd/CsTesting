import {
  BOT_TICK_RATE, Buttons,
  type BotCommand, type BotCommsMessage, type BotConfigFile, type BotEnemyView,
  type BotCombatEvent, type BotSensorView, type BotSkillTier, type BotTelemetrySnapshot, type BotWeaponView,
} from '@tactical/shared/bot-api';
import {
  angularError, computeDesiredAim, createAimState, eyeHeight, gaussian, reactionDelayMs,
  stepAim, targetPoint, tickFromMs, wrapAngle, type AimState,
} from './aim';
import { samplePersonality, tierOf, type Personality } from './personality';
import { CommsChannel } from './comms';
import { emptyTelemetry } from '@tactical/shared/bot-api';

const TICK = BOT_TICK_RATE;
const DEG = Math.PI / 180;

export interface RoundPlan {
  roundNumber: number;
  site: 'A' | 'B';
  altSite: 'A' | 'B';
  tactic: string;
}

interface MemoryEntry { x: number; y: number; z: number; tick: number; confidence: number; visible: boolean }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROLE_POOL: Record<'T' | 'CT', string[]> = {
  T: ['entry', 'support', 'lurker', 'entry', 'igl'],
  CT: ['anchor', 'awper', 'support', 'lurker', 'igl'],
};

export class BotSquad {
  readonly team: 'T' | 'CT';
  private readonly cfg: BotConfigFile;
  private readonly rng: () => number;
  private readonly bots = new Map<number, HumanBot>();
  private readonly commsChannel = new CommsChannel();
  private plan: RoundPlan = { roundNumber: 0, site: 'A', altSite: 'B', tactic: 'default' };

  constructor(team: 'T' | 'CT', cfg: BotConfigFile, seed = 12345) {
    this.team = team;
    this.cfg = cfg;
    this.rng = mulberry32(seed);
  }

  addBot(id: number, tier: string, role?: string): HumanBot {
    const used = new Set(Array.from(this.bots.values()).map((b) => b.role));
    const pool = ROLE_POOL[this.team].filter((r) => !used.has(r));
    const chosenRole = role ?? pool[0] ?? ROLE_POOL[this.team][this.bots.size % ROLE_POOL[this.team].length]!;
    const bot = new HumanBot(id, tier, chosenRole, this.cfg, this, this.rng, 0x9e37 + id * 7919);
    this.bots.set(id, bot);
    return bot;
  }

  removeBot(id: number): void { this.bots.delete(id); }
  hasBot(id: number): boolean { return this.bots.has(id); }
  getBot(id: number): HumanBot | undefined { return this.bots.get(id); }

  getPlan(): RoundPlan { return this.plan; }
  getTeamSize(): number { return this.bots.size; }

  /** Telemetry công cụ: chỉ đọc sự kiện công khai của trận, không ảnh hưởng AI. */
  observeEvent(e: BotCombatEvent): void {
    if (e.attacker !== null && e.attacker !== undefined) {
      const attacker = this.bots.get(e.attacker);
      if (attacker) {
        const t = attacker.getTelemetry();
        if (e.type === 'hit') { t.hits++; }
        if (e.type === 'kill') {
          t.kills++;
          if (e.headshot) t.headshots++;
        }
      }
    }
    if (e.victim !== null && e.victim !== undefined) {
      const victim = this.bots.get(e.victim);
      if (victim && e.type === 'kill') victim.getTelemetry().deaths++;
    }
  }

  emitComms(from: HumanBot, kind: BotCommsMessage['kind'], text: string, tick: number, x?: number, y?: number, z?: number, confidence = 0.8): void {
    const delay = this.cfg.shared.commsDelayMinSec
      + this.rng() * Math.max(0, this.cfg.shared.commsDelayMaxSec - this.cfg.shared.commsDelayMinSec);
    const wrong = this.rng() < this.cfg.shared.commsWrongChance;
    this.commsChannel.send(
      from.id, this.team, kind, text, tick, delay,
      x === undefined ? undefined : x + (wrong ? (this.rng() * 2 - 1) * 5 : 0),
      y, z === undefined ? undefined : z + (wrong ? (this.rng() * 2 - 1) * 5 : 0),
      wrong ? confidence * 0.5 : confidence,
    );
  }

  think(view: BotSensorView): BotCommand {
    const bot = this.bots.get(view.self.id);
    if (!bot) return { forward: 0, right: 0, yaw: view.self.yaw, pitch: view.self.pitch, buttons: 0, grenadeSlot: 0 };
    this.commsChannel.pump(view.tick);
    this.ensurePlan(view);
    const comms = this.commsChannel.getFor(bot.id, view.tick);
    const enriched: BotSensorView = { ...view, comms: [...view.comms, ...comms] };
    return bot.think(enriched);
  }

  private ensurePlan(view: BotSensorView): void {
    const rn = view.round.roundNumber;
    if (rn === this.plan.roundNumber) return;
    const prevSite = this.plan.site;
    const site: 'A' | 'B' = this.rng() < 0.5 ? 'A' : 'B';
    // tránh lặp site 3 vòng liên tiếp
    const pick = site === prevSite && this.rng() < 0.35 ? (site === 'A' ? 'B' : 'A') : site;
    const tactics = this.cfg.tactics[this.team] ?? {};
    const entries = Object.entries(tactics);
    let tactic = 'default';
    if (entries.length > 0) {
      let total = 0;
      const weights = entries.map(([name, t]) => {
        let w = t.weightBase;
        if (this.team === 'T' && name === 'save' && view.match.ownEconomy !== 'eco') w *= 0.2;
        total += w;
        return { name, w };
      });
      let roll = this.rng() * total;
      for (const { name, w } of weights) { roll -= w; if (roll <= 0) { tactic = name; break; } }
    }
    this.plan = { roundNumber: rn, site: pick, altSite: pick === 'A' ? 'B' : 'A', tactic };
    for (const bot of this.bots.values()) bot.setPlan(this.plan);
  }

  telemetry(): BotTelemetrySnapshot[] {
    return Array.from(this.bots.values()).map((b) => b.getTelemetry());
  }
}

export class HumanBot {
  readonly id: number;
  readonly tierName: string;
  readonly tier: BotSkillTier;
  readonly role: string;
  readonly cfg: BotConfigFile;
  private readonly squad: BotSquad;
  private readonly rng: () => number;
  private readonly personality: Personality;
  private readonly aim: AimState;
  private memory = new Map<number, MemoryEntry>();
  private plan: RoundPlan;
  private targetId: number | null = null;
  private path: { x: number; y: number; z: number }[] = [];
  private pathIndex = 0;
  private destination: { x: number; z: number } | null = null;
  private destCacheRound = -1;
  private lastRepathTick = -999;
  private lastThinkPos = { x: 0, y: 0, z: 0 };
  private lastProgressTick = 0;
  private stuckCount = 0;
  private lastRoundNumber = -1;
  private reactionUntilTick = 0;
  private burstUntilTick = 0;
  private nextBurstTick = 0;
  private firePulse = false;
  private strafeDir = 1;
  private strafeUntilTick = 0;
  private buyCooldownTick = 0;
  private utilityCooldownTick = 0;
  private grenadeStage: 'none' | 'select' | 'throw' = 'none';
  private grenadeKind: 'he' | 'flash' | 'smoke' | 'molotov' | 'incendiary' = 'he';
  private grenadeTarget = { x: 0, z: 0 };
  private grenadeStageUntil = 0;
  private scopeWanted = false;
  private hint: { x: number; y: number; z: number; tick: number } | null = null;
  private externalCommsTick = 0;
  private telemetry: BotTelemetrySnapshot;
  private shotsSinceReload = 0;
  private lastAcquireTick = 0;
  private pendingMistake: string | null = null;
  private holdSpot: { x: number; z: number } | null = null;
  private avgSpeed = 0;

  constructor(
    id: number, tierName: string, role: string, cfg: BotConfigFile, squad: BotSquad,
    rng: () => number, seed: number,
  ) {
    this.id = id;
    this.tierName = tierName;
    this.tier = tierOf(cfg, tierName);
    this.role = role;
    this.cfg = cfg;
    this.squad = squad;
    this.rng = mulberry32(seed);
    this.personality = samplePersonality(cfg, this.rng);
    this.aim = createAimState(0, 0);
    this.plan = { roundNumber: 0, site: 'A', altSite: 'B', tactic: 'default' };
    this.telemetry = emptyTelemetry(id, tierName, role);
    void rng;
  }

  setPlan(plan: RoundPlan): void {
    if (plan.roundNumber !== this.plan.roundNumber) {
      this.plan = plan;
      this.destCacheRound = -1;
      this.holdSpot = null;
    }
  }

  getTelemetry(): BotTelemetrySnapshot { return this.telemetry; }

  think(view: BotSensorView): BotCommand {
    const self = view.self;
    const cmd: BotCommand = {
      forward: 0, right: 0, yaw: self.yaw, pitch: self.pitch, buttons: 0, grenadeSlot: 0,
      debug: '',
    };
    if (!self.alive) {
      return cmd;
    }
    if (this.lastRoundNumber !== view.round.roundNumber) {
      this.onRoundStart(view);
    }
    this.updateComms(view);
    if (view.round.phase === 'freeze') {
      this.aim.yaw = self.yaw; this.aim.pitch = self.pitch;
      const buy = this.decideBuy(view);
      if (buy) { cmd.buyItem = buy; cmd.debug = `buy:${buy}`; }
      return cmd;
    }
    this.observe(view);
    this.updateMemoryFromComms(view);

    const target = this.selectTarget(view);
    const objective = this.decideObjective(view);
    let useHeld = false;
    let movement = { x: 0, z: 0 };
    let shouldFire = false;
    let crouchWanted = false;

    // Hành động mục tiêu: đặt/gỡ bom, nhặt bom
    const action = this.objectiveAction(view, objective, target);
    useHeld = action.use;

    if (target) {
      const combat = this.combat(view, target);
      movement = combat.move;
      shouldFire = combat.fire && !action.blockFire;
      crouchWanted = combat.crouch;
    } else if (!action.stop) {
      movement = this.navigate(view, objective);
    }

    // Nếu đứng đặt/gỡ bom thì không di chuyển, không bắn
    if (action.stop) { movement = { x: 0, z: 0 }; shouldFire = false; }

    // Kỹ thuật di chuyển
    const speed = Math.sqrt(self.vx * self.vx + self.vz * self.vz);
    this.avgSpeed = this.avgSpeed * 0.9 + speed * 0.1;
    if (movement.x !== 0 || movement.z !== 0) {
      const len = Math.hypot(movement.x, movement.z);
      const nx = movement.x / len, nz = movement.z / len;
      const fwdX = Math.sin(this.aim.yaw), fwdZ = Math.cos(this.aim.yaw);
      const rightX = Math.cos(this.aim.yaw), rightZ = -Math.sin(this.aim.yaw);
      cmd.forward = fwdX * nx + fwdZ * nz;
      cmd.right = rightX * nx + rightZ * nz;
    }

    // Ngắm: mục tiêu hoặc hướng di chuyển/quét
    if (target) {
      this.aimAtEntity(view, target);
    } else {
      this.idleAim(view, movement, objective);
    }
    cmd.yaw = this.aim.yaw;
    cmd.pitch = this.aim.pitch;

    // Nút
    let buttonsOut = action.buttons;
    if (useHeld) buttonsOut |= Buttons.Use;
    if (this.shouldWalk(view, target)) buttonsOut |= Buttons.Walk;
    if (action.crouch || crouchWanted) buttonsOut |= Buttons.Crouch;

    // Súng
    const weapon = self.weapon;
    const ammo = self.ammo;
    if (weapon.fireMode !== 'melee' && ammo <= 0) {
      if (self.reserve > 0) buttonsOut |= Buttons.Reload;
      else if (self.activeSlot !== 'grenade') buttonsOut |= Buttons.SlotSecondary;
    }
    if (self.reloading) shouldFire = false;
    if (weapon.category === 'sniper' && target && target.distance > 18 && !self.scoped) shouldFire = false;
    if (ammo <= 3 && !target && self.reserve > 0) buttonsOut |= Buttons.Reload;
    if (shouldFire) {
      this.manageBurst(view, weapon, target);
      if (view.tick < this.burstUntilTick) buttonsOut |= Buttons.Fire;
    }
    if (this.scopeWanted && !self.scoped && weapon.category === 'sniper') {
      buttonsOut |= Buttons.Scope;
      this.scopeWanted = false;
    }
    if (target && weapon.category === 'sniper' && target.distance > 18) this.scopeWanted = true;

    // Lựu đạn: ngắm về điểm ném trước khi bấm
    if (this.grenadeStage !== 'none') {
      const targetYaw = Math.atan2(this.grenadeTarget.x - self.x, this.grenadeTarget.z - self.z);
      const dx = this.grenadeTarget.x - self.x, dz = this.grenadeTarget.z - self.z;
      const dist = Math.hypot(dx, dz);
      const pitch = Math.atan2(0.6, Math.max(2, dist)) + 0.12;
      this.aim.yaw = wrapAngle(this.aim.yaw + wrapAngle(targetYaw - this.aim.yaw) * 0.6);
      this.aim.pitch += (pitch - this.aim.pitch) * 0.5;
      cmd.yaw = this.aim.yaw;
      cmd.pitch = this.aim.pitch;
    }
    const grenadeCmd = this.utility(view, target, objective, action.stop);
    if (grenadeCmd) {
      if (grenadeCmd.select) buttonsOut |= Buttons.SlotGrenade;
      if (grenadeCmd.throw) buttonsOut |= Buttons.Fire;
      cmd.grenadeSlot = grenadeCmd.slot;
    }

    // Kẹt
    if ((movement.x !== 0 || movement.z !== 0) && this.checkStuck(view)) {
      buttonsOut |= Buttons.Jump;
      this.path = [];
      this.lastRepathTick = -999;
      this.telemetry.mistakes.push('stuck_escape');
      if (this.telemetry.mistakes.length > 40) this.telemetry.mistakes.shift();
    }

    cmd.buttons = buttonsOut;
    cmd.debug = `${this.role}/${this.plan.tactic} tgt=${target?.id ?? '-'} obj=${objective.x.toFixed(0)},${objective.z.toFixed(0)}`;
    this.recordTelemetry(view, target, shouldFire);
    return cmd;
  }

  private onRoundStart(view: BotSensorView): void {
    this.lastRoundNumber = view.round.roundNumber;
    this.memory.clear();
    this.targetId = null;
    this.path = [];
    this.pathIndex = 0;
    this.destination = null;
    this.destCacheRound = -1;
    this.holdSpot = null;
    this.grenadeStage = 'none';
    this.burstUntilTick = 0;
    this.nextBurstTick = 0;
    this.aim.errorYaw = 0; this.aim.errorPitch = 0;
    this.aim.overshootYaw = 0; this.aim.overshootPitch = 0;
    this.reactionUntilTick = 0;
    this.shotsSinceReload = 0;
  }

  private updateComms(view: BotSensorView): void {
    // tin đồng đội: lưu hint gần nhất
    let best: { x: number; y: number; z: number; tick: number } | null = null;
    for (const m of view.comms) {
      if (m.kind !== 'enemy_spotted' && m.kind !== 'enemy_heard') continue;
      if (m.x === undefined || m.z === undefined) continue;
      if (view.tick - m.tickReceived > TICK * 6) continue;
      if (!best || m.tickReceived > best.tick) best = { x: m.x, y: m.y ?? 0, z: m.z, tick: m.tickReceived };
    }
    if (best) this.hint = best;
  }

  private updateMemoryFromComms(view: BotSensorView): void {
    for (const m of view.comms) {
      if (m.kind !== 'enemy_spotted' || m.x === undefined || m.z === undefined) continue;
      if (view.tick - m.tickReceived > TICK * 5) continue;
      this.hint = { x: m.x, y: m.y ?? 0, z: m.z, tick: m.tickReceived };
    }
  }

  private observe(view: BotSensorView): void {
    const now = view.tick;
    for (const e of view.enemies) {
      const prev = this.memory.get(e.id);
      this.memory.set(e.id, { x: e.x, y: e.y, z: e.z, tick: now, confidence: 1, visible: true });
      if (!prev || now - prev.tick > TICK * 2) {
        this.lastAcquireTick = now;
        const peripheral = e.angleOffAim > 25 * DEG;
        const ms = reactionDelayMs(this.tier.reactionMedianMs, this.tier.reactionSigma, this.cfg.shared.reactFirstSightPenalty, peripheral, this.rng);
        this.reactionUntilTick = Math.max(this.reactionUntilTick, now + tickFromMs(ms));
        this.telemetry.reactionTimesMs.push(Math.round(ms));
        if (this.telemetry.reactionTimesMs.length > 120) this.telemetry.reactionTimesMs.shift();
      }
    }
    for (const [id, m] of this.memory) {
      if (m.visible) { m.visible = false; continue; }
      if (now - m.tick > TICK * 10) this.memory.delete(id);
      else m.confidence = Math.max(0, m.confidence - this.cfg.shared.beliefDecayPerSec / 10);
    }
    // âm thanh: ghi nhớ vị trí thô để pre-aim
    for (const s of view.sounds) {
      if (s.kind !== 'gunshot' && s.kind !== 'footstep') continue;
      if (s.fromTeammate) continue;
      const age = now - s.tick;
      if (age > TICK * 2) continue;
      const w = this.tier.soundAwareness;
      if (this.rng() > w) continue;
      this.hint = { x: s.x, y: s.y, z: s.z, tick: now };
    }
  }

  private selectTarget(view: BotSensorView): BotEnemyView | null {
    if (view.self.blinded) return null;
    let best: BotEnemyView | null = null;
    let bestScore = -Infinity;
    // Chỉ coi là mục tiêu trong tầm bắn hiệu quả của súng đang cầm.
    const cat = view.self.weapon.category;
    const maxRange = cat === 'pistol' ? 34 : cat === 'heavy_pistol' ? 40 : cat === 'smg' ? 38
      : cat === 'shotgun' ? 22 : cat === 'sniper' ? 120 : cat === 'rifle' ? 65 : 30;
    for (const e of view.enemies) {
      if (e.distance > maxRange) continue;
      let score = 100 / (e.distance + 8);
      if (e.visibleParts.includes('head')) score += 8;
      score += e.exposure * 6;
      if (e.health < 40) score += 6;
      // ưu tiên kẻ đang chĩa súng về phía mình (dựa vào hướng nhìn quan sát được)
      const dx = view.self.x - e.x, dz = view.self.z - e.z;
      const len = Math.hypot(dx, dz) || 1;
      const facing = Math.sin(e.yaw) * (dx / len) + Math.cos(e.yaw) * (dz / len);
      if (facing > 0.85) score += 12;
      if (e.id === this.targetId) score += 4;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    this.targetId = best?.id ?? null;
    return best;
  }

  private aimAtEntity(view: BotSensorView, target: BotEnemyView): void {
    if (this.aim.targetId !== target.id) {
      this.aim.targetId = target.id;
      this.aim.targetAcquiredTick = view.tick;
      const distScale = Math.min(3, Math.max(0.7, target.distance / 18));
      const err = this.tier.aimErrorDeg * DEG * distScale * (1 + this.personality.tiltSensitivity * view.match.lossStreak * 0.08);
      this.aim.errorYaw = gaussian(this.rng) * err;
      this.aim.errorPitch = gaussian(this.rng) * err * 0.6;
      const dYaw = wrapAngle(Math.atan2(target.x - view.self.x, target.z - view.self.z) - this.aim.yaw);
      this.aim.overshootYaw = Math.abs(dYaw) > 12 * DEG ? dYaw * this.tier.flickOvershoot * (0.5 + this.rng()) : 0;
      this.aim.overshootPitch = gaussian(this.rng) * this.tier.flickOvershoot * 0.03;
      // sai số nhỏ ngẫu nhiên lúc bám
      if (this.rng() < this.tier.mistakeRate * 0.15) {
        this.aim.errorYaw += gaussian(this.rng) * 2.2 * DEG;
        this.pendingMistake = 'overflick';
      }
    }
    const point: 'head' | 'chest' = target.distance < 32 && this.rng() < this.tier.headshotAimBias ? 'head' : 'chest';
    this.aim.aimPoint = point;
    const tp = targetPoint(target, point);
    const desired = computeDesiredAim(
      view.self, { x: tp[0], y: tp[1], z: tp[2] }, point,
      view.self.weapon.recoil, this.tier.sprayControl,
    );
    const maxStep = this.tier.aimSpeedDegPerSec * DEG * 0.1 * (0.85 + 0.3 * this.rng());
    this.aim.errorYaw *= 0.86;
    this.aim.errorPitch *= 0.86;
    const desiredYaw = desired.yaw + this.aim.errorYaw;
    const desiredPitch = desired.pitch + this.aim.errorPitch;
    stepAim(this.aim, desiredYaw, desiredPitch, Math.min(maxStep, this.cfg.shared.maxTurnRateDegPerSec * DEG * 0.1), this.tier.flickOvershoot, view.tick);
    this.aim.pitch = Math.max(-1.5, Math.min(1.5, this.aim.pitch));
    void angularError;
  }

  private idleAim(view: BotSensorView, movement: { x: number; z: number }, _objective: { x: number; z: number }): void {
    const now = view.tick;
    let wantYaw: number;
    if (movement.x !== 0 || movement.z !== 0) {
      wantYaw = Math.atan2(movement.x, movement.z);
      // quét nhẹ khi di chuyển
      wantYaw += Math.sin(now * 0.012) * 6 * DEG;
    } else {
      const base = this.holdSpot ? Math.atan2(this.holdSpot.x - view.self.x, this.holdSpot.z - view.self.z) : view.self.yaw;
      wantYaw = base + Math.sin(now * 0.004) * 20 * DEG;
    }
    if (this.hint && now - this.hint.tick < TICK * 4) {
      wantYaw = Math.atan2(this.hint.x - view.self.x, this.hint.z - view.self.z);
    }
    const desired = { yaw: wantYaw, pitch: -0.01 };
    const maxStep = this.tier.aimSpeedDegPerSec * DEG * 0.1 * 0.7;
    stepAim(this.aim, desired.yaw, desired.pitch, Math.min(maxStep, 140 * DEG * 0.1), 0, now);
    this.aim.pitch = Math.max(-1.2, Math.min(1.2, this.aim.pitch));
    this.telemetry.crosshairHeightsM.push(eyeHeight(view.self) + Math.tan(this.aim.pitch) * 10);
    if (this.telemetry.crosshairHeightsM.length > 200) this.telemetry.crosshairHeightsM.shift();
  }

  private decideObjective(view: BotSensorView): { x: number; z: number; hold: boolean } {
    const r = view.round;
    const self = view.self;
    if (r.bombPlanted) {
      if (self.team === 'CT') return { x: r.bombX, z: r.bombZ, hold: false };
      if (!this.holdSpot || this.destCacheRound !== r.roundNumber) {
        const ang = this.rng() * Math.PI * 2;
        const rad = 4 + this.rng() * 5;
        const p = view.map.nav.randomPointNear(r.bombX + Math.sin(ang) * rad, r.bombZ + Math.cos(ang) * rad, 3);
        this.holdSpot = { x: p[0], z: p[1] };
      }
      return { x: this.holdSpot.x, z: this.holdSpot.z, hold: true };
    }
    if (self.team === 'T' && r.bombDropped) {
      const mates = view.teammates.filter((t) => t.alive);
      const myDist = Math.hypot(self.x - r.bombDroppedX, self.z - r.bombDroppedZ);
      const closer = mates.every((t) => Math.hypot(t.x - r.bombDroppedX, t.z - r.bombDroppedZ) >= myDist);
      if (closer) return { x: r.bombDroppedX, z: r.bombDroppedZ, hold: false };
    }
    const site = this.assignedSite(view);
    if (this.destCacheRound !== r.roundNumber) {
      this.destCacheRound = r.roundNumber;
      const center = site.center;
      const spread = self.team === 'CT' ? 5 : 7;
      const p = view.map.nav.randomPointNear(center[0], center[2], spread);
      this.holdSpot = { x: p[0], z: p[1] };
    }
    if (!this.holdSpot) this.holdSpot = { x: site.center[0], z: site.center[2] };
    return { x: this.holdSpot.x, z: this.holdSpot.z, hold: true };
  }

  private assignedSite(view: BotSensorView): { center: [number, number, number] } {
    const a = view.round.siteA;
    const b = view.round.siteB;
    const fallback = { id: 'A' as const, rect: [-10, -50, 10, -20] as [number, number, number, number], center: [0, 0, -30] as [number, number, number] };
    const siteA = a ?? fallback;
    const siteB = b ?? { ...fallback, id: 'B' as const, center: [0, 0, 30] as [number, number, number] };
    if (this.role === 'lurker') return this.plan.altSite === 'A' ? siteA : siteB;
    return this.plan.site === 'A' ? siteA : siteB;
  }

  private navigate(view: BotSensorView, objective: { x: number; z: number; hold: boolean }): { x: number; z: number } {
    const self = view.self;
    const distToObj = Math.hypot(objective.x - self.x, objective.z - self.z);
    if (distToObj < 1.4) {
      // đã tới nơi: đứng giữ, thỉnh thoảng nhích
      if (this.rng() < 0.02) {
        const p = view.map.nav.randomPointNear(self.x, self.z, 3);
        this.destination = { x: p[0], z: p[1] };
        this.path = [];
      }
      return { x: 0, z: 0 };
    }
    if (this.destination === null || Math.hypot(this.destination.x - objective.x, this.destination.z - objective.z) > 2
      || view.tick - this.lastRepathTick > this.cfg.shared.navPathReplanSec * TICK || this.path.length === 0) {
      this.destination = { x: objective.x, z: objective.z };
      this.lastRepathTick = view.tick;
      this.path = [];
      this.pathIndex = 0;
      const n = view.map.nav.findPath(self.x, self.z, objective.x, objective.z, this.path);
      if (n === 0) {
        const p = view.map.nav.randomPointNear(self.x, self.z, 5);
        this.destination = { x: p[0], z: p[1] };
      }
      // biến thiên đường đi: lệch điểm tới
      if (this.path.length > 0) {
        this.telemetry.pathVariationM += Math.min(3, this.rng() * 1.2);
      }
    }
    while (this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex]!;
      const d = Math.hypot(wp.x - self.x, wp.z - self.z);
      if (d < 0.8) this.pathIndex++;
      else break;
    }
    let tx = objective.x, tz = objective.z;
    if (this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex]!;
      tx = wp.x; tz = wp.z;
    }
    let dx = tx - self.x, dz = tz - self.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return { x: 0, z: 0 };
    dx /= len; dz /= len;
    // tránh đồng đội chắn đường
    for (const mate of view.teammates) {
      if (!mate.alive) continue;
      const mdx = self.x - mate.x, mdz = self.z - mate.z;
      const md = Math.hypot(mdx, mdz);
      if (md < 1.1 && md > 0.01) {
        dx += (mdx / md) * 0.6;
        dz += (mdz / md) * 0.6;
      }
    }
    const nl = Math.hypot(dx, dz) || 1;
    return { x: dx / nl, z: dz / nl };
  }

  private shouldWalk(view: BotSensorView, target: BotEnemyView | null): boolean {
    if (target) return false;
    const r = view.round;
    // Chỉ đi chậm khi áp sát khu vực có địch vừa thấy, tránh bò cả bản đồ.
    let nearContact = false;
    for (const m of this.memory.values()) {
      if (view.tick - m.tick < TICK * 4) { nearContact = true; break; }
    }
    if (!nearContact) return false;
    const d = Math.hypot(this.destination ? this.destination.x - view.self.x : 0, this.destination ? this.destination.z - view.self.z : 0);
    return r.phaseTimeLeftSec > 20 && d < 14;
  }

  private combat(view: BotSensorView, target: BotEnemyView): { move: { x: number; z: number }; fire: boolean; crouch: boolean } {
    const self = view.self;
    const speed = Math.hypot(self.vx, self.vz);
    const dist = target.distance;
    const toX = target.x - self.x, toZ = target.z - self.z;
    const len = Math.hypot(toX, toZ) || 1;
    const dirX = toX / len, dirZ = toZ / len;
    let move = { x: 0, z: 0 };
    let fire = false;
    let crouch = false;

    if (view.tick > this.strafeUntilTick) {
      this.strafeDir = this.rng() < 0.5 ? -1 : 1;
      this.strafeUntilTick = view.tick + Math.round((0.5 + this.rng() * 1.1) * TICK);
    }

    const lowHealth = self.health < 35;
    const wantsRange = dist > 9;
    if (wantsRange && speed > 0.45) {
      // counter-strafe: đạp ngược chiều vận tốc
      const vx = self.vx / (speed || 1), vz = self.vz / (speed || 1);
      move = { x: -vx, z: -vz };
      fire = false;
    } else if (wantsRange) {
      // đứng yên bắn, thỉnh thoảng strafe ngắn
      if (this.rng() < 0.25 && view.tick > this.strafeUntilTick - TICK * 0.4) {
        const rx = Math.cos(this.aim.yaw) * this.strafeDir;
        const rz = -Math.sin(this.aim.yaw) * this.strafeDir;
        move = { x: rx, z: rz };
      } else {
        move = { x: 0, z: 0 };
      }
      fire = true;
      if (this.role === 'anchor' && dist > 20 && this.rng() < 0.2) crouch = true;
    } else {
      // gần: strafe liên tục, bắn
      const rx = Math.cos(this.aim.yaw) * this.strafeDir;
      const rz = -Math.sin(this.aim.yaw) * this.strafeDir;
      move = { x: rx, z: rz };
      fire = true;
    }

    if (lowHealth && this.personality.riskTaking < 0.5 && dist > 12) {
      move = { x: -dirX, z: -dirZ };
      fire = false;
      this.pendingMistake = 'retreat_low_hp';
    }
    // đổi mục tiêu/không đứng yên quá lâu
    if (this.aim.settledTicks > 40 && dist > 20) {
      move = { x: Math.cos(this.aim.yaw) * this.strafeDir, z: -Math.sin(this.aim.yaw) * this.strafeDir };
    }
    return { move, fire, crouch };
  }

  private manageBurst(view: BotSensorView, weapon: BotWeaponView, target: BotEnemyView | null): void {
    if (!target) return;
    const aligned = this.isAimed(view, target);
    if (!aligned || view.tick < this.reactionUntilTick) { this.burstUntilTick = 0; return; }
    if (view.tick < this.nextBurstTick) return;
    const dist = target.distance;
    let burstMs: number;
    const skill = this.tier.burstDiscipline;
    if (weapon.fireMode === 'semi' || weapon.fireMode === 'bolt' || weapon.fireMode === 'pump') {
      burstMs = 60;
    } else if (dist < 9) burstMs = 320 + 160 * skill;
    else if (dist < 22) burstMs = 150 + 140 * skill;
    else burstMs = 70 + 90 * skill;
    if (this.rng() < this.tier.mistakeRate * 0.1) burstMs *= 1.8;
    this.burstUntilTick = view.tick + Math.round(burstMs / 1000 * TICK);
    const pauseMs = (dist < 9 ? 80 : 180) + (1 - skill) * 220 + this.rng() * 120;
    this.nextBurstTick = this.burstUntilTick + Math.round(pauseMs / 1000 * TICK);
    if (this.burstUntilTick > 0) this.telemetry.shotsFired++;
  }

  private isAimed(view: BotSensorView, target: BotEnemyView): boolean {
    const tp = targetPoint(target, this.aim.aimPoint);
    const desired = computeDesiredAim(view.self, { x: tp[0], y: tp[1], z: tp[2] }, this.aim.aimPoint,
      view.self.weapon.recoil, this.tier.sprayControl);
    const err = angularError(this.aim.yaw, this.aim.pitch, desired.yaw, desired.pitch);
    const threshold = Math.atan(0.55 / Math.max(4, target.distance)) + 0.25 * DEG * (1 - this.tier.counterStrafeSkill);
    return err < threshold;
  }

  private objectiveAction(view: BotSensorView, _objective: { x: number; z: number; hold: boolean }, target: BotEnemyView | null): { use: boolean; stop: boolean; blockFire: boolean; buttons: number; crouch: boolean } {
    const self = view.self;
    const r = view.round;
    const res = { use: false, stop: false, blockFire: false, buttons: 0, crouch: false };
    const speed = Math.hypot(self.vx, self.vz);
    if (r.phase !== 'live') return res;
    // Nhặt bom rơi
    if (self.team === 'T' && r.bombDropped && r.phase === 'live') {
      const d = Math.hypot(self.x - r.bombDroppedX, self.z - r.bombDroppedZ);
      if (d < 1.7) { res.use = true; res.stop = true; res.buttons |= Buttons.Use; }
    }
    // Đặt bom
    if (self.hasBomb && r.phase === 'live') {
      const site = this.siteAt(view, self.x, self.z);
      const clear = !target || target.distance > 12;
      if (site && clear && speed < 0.7 && (r.phaseTimeLeftSec < 40 || this.rng() < 0.7)) {
        res.use = true; res.stop = true; res.blockFire = true; res.buttons |= Buttons.Use;
        if (this.rng() < 0.02) this.telemetry.mistakes.push('planted_in_open');
      }
    }
    // Gỡ bom
    if (self.team === 'CT' && r.bombPlanted) {
      const d = Math.hypot(self.x - r.bombX, self.z - r.bombZ);
      const danger = target !== null;
      const timeToSpare = r.bombTimeLeftSec > (self.hasDefuseKit ? 5.5 : 10.5);
      if (d < 1.7 && (!danger || !timeToSpare || r.bombTimeLeftSec < 6)) {
        res.use = true; res.stop = true; res.blockFire = true; res.buttons |= Buttons.Use;
      }
    }
    return res;
  }

  private siteAt(view: BotSensorView, x: number, z: number): 'A' | 'B' | null {
    for (const s of [view.round.siteA, view.round.siteB]) {
      if (!s) continue;
      const [x1, z1, x2, z2] = s.rect;
      if (x >= x1 && x <= x2 && z >= z1 && z <= z2) return s.id;
    }
    return null;
  }

  private utility(view: BotSensorView, target: BotEnemyView | null, objective: { x: number; z: number; hold: boolean }, busy: boolean): { select: boolean; throw: boolean; slot: number } | null {
    const self = view.self;
    if (busy || target || view.tick < this.utilityCooldownTick) return null;
    if (this.grenadeStage === 'select') {
      if (view.tick < this.grenadeStageUntil) {
        return { select: true, throw: false, slot: this.grenadeSlotFor(view, this.grenadeKind) };
      }
      this.grenadeStage = 'throw';
      this.grenadeStageUntil = view.tick + 8;
      return { select: false, throw: true, slot: this.grenadeSlotFor(view, this.grenadeKind) };
    }
    if (this.grenadeStage === 'throw') {
      if (view.tick < this.grenadeStageUntil) {
        return { select: false, throw: true, slot: this.grenadeSlotFor(view, this.grenadeKind) };
      }
      this.grenadeStage = 'none';
      this.utilityCooldownTick = view.tick + TICK * 6;
    }
    const available = (Object.keys(self.grenades) as (keyof typeof self.grenades)[])
      .filter((k) => self.grenades[k] > 0);
    if (available.length === 0) return null;
    if (this.rng() > this.tier.utilityDiscipline * 0.35) return null;
    const kind = available.find((k) => k === 'smoke') ?? available.find((k) => k === 'flash') ?? available.find((k) => k === 'he');
    if (!kind) return null;
    const r = view.round;
    const useOnSite = (kind === 'smoke' || kind === 'flash') && !r.bombPlanted && r.phaseTimeLeftSec > 40;
    if (useOnSite && self.team === 'T') {
      this.grenadeKind = kind;
      this.grenadeTarget = { x: objective.x, z: objective.z };
    } else if (this.hint && view.tick - this.hint.tick < TICK * 3) {
      this.grenadeKind = kind;
      this.grenadeTarget = { x: this.hint.x, z: this.hint.z };
    } else return null;
    if (Math.hypot(self.x - this.grenadeTarget.x, self.z - this.grenadeTarget.z) > 32) return null;
    this.grenadeStage = 'select';
    this.grenadeStageUntil = view.tick + 8;
    this.telemetry.utilityThrown++;
    return { select: true, throw: false, slot: this.grenadeSlotFor(view, kind) };
  }

  private grenadeSlotFor(view: BotSensorView, kind: keyof BotSensorView['self']['grenades']): number {
    const order: (keyof BotSensorView['self']['grenades'])[] = ['he', 'flash', 'smoke', 'molotov', 'incendiary'];
    const available = order.filter((k) => view.self.grenades[k] > 0);
    const idx = available.indexOf(kind);
    return idx < 0 ? 0 : idx;
  }

  private decideBuy(view: BotSensorView): string | null {
    const self = view.self;
    if (view.tick < this.buyCooldownTick) return null;
    const opts = view.match.buyOptions;
    const find = (id: string) => opts.find((o) => o.id === id);
    const primary = self.primaryId;
    const team = self.team;
    const want = (id: string): string | null => {
      const o = find(id);
      if (!o) return null;
      if (self.money < o.price) return null;
      return id;
    };
    let item: string | null = null;
    // Ưu tiên súng trước, rồi giáp; người chơi thật cũng mua theo thứ tự này.
    if (!primary) {
      const rifle = team === 'T' ? 'rifle_t' : 'rifle_ct';
      if (this.role === 'awper' && self.money >= 4750) item = want('sniper');
      item = item ?? want(rifle) ?? want(team === 'T' ? 'smg_t' : 'smg_ct') ?? want('shotgun');
      if (!item && self.money >= 1200) item = want('heavy_pistol');
    }
    if (!item && self.armor <= 0) {
      item = want('kevlar_helmet') ?? want('kevlar');
    }
    if (!item && team === 'CT' && !self.hasDefuseKit && self.money >= 400) item = want('defuse_kit');
    if (!item) {
      const nades = (['he', 'flash', 'smoke', 'molotov'] as const).filter((k) => self.grenades[k] > 0);
      if (nades.length < 2) {
        if (self.money >= 600) item = want('flash') ?? want('smoke');
        else if (self.money >= 300) item = want('he');
      }
    }
    if (item) {
      this.buyCooldownTick = view.tick + (view.round.phase === 'freeze' ? TICK * 0.5 : TICK * 3);
      return item;
    }
    return null;
  }

  private checkStuck(view: BotSensorView): boolean {
    const self = view.self;
    const now = view.tick;
    if (this.lastProgressTick === 0) { this.lastProgressTick = now; this.lastThinkPos = { x: self.x, y: self.y, z: self.z }; return false; }
    const moved = Math.hypot(self.x - this.lastThinkPos.x, self.z - this.lastThinkPos.z);
    if (moved > this.cfg.shared.stuckMinMoveM) {
      this.lastThinkPos = { x: self.x, y: self.y, z: self.z };
      this.lastProgressTick = now;
      this.stuckCount = 0;
      return false;
    }
    if (now - this.lastProgressTick > this.cfg.shared.stuckWindowSec * TICK) {
      this.lastProgressTick = now;
      this.stuckCount++;
      return this.stuckCount <= 3;
    }
    return false;
  }

  private recordTelemetry(view: BotSensorView, target: BotEnemyView | null, firing: boolean): void {
    const self = view.self;
    this.telemetry.averageSpeed = this.avgSpeed;
    this.telemetry.crosshairHeightsM.push(eyeHeight(self) + Math.tan(this.aim.pitch) * 10);
    if (this.telemetry.crosshairHeightsM.length > 300) this.telemetry.crosshairHeightsM.shift();
    if (firing && target) {
      this.telemetry.timeToKillMs.push((view.tick - this.aim.targetAcquiredTick) * (1000 / TICK));
      if (this.telemetry.timeToKillMs.length > 100) this.telemetry.timeToKillMs.shift();
      this.telemetry.counterStrafeAttempts++;
      if (Math.hypot(self.vx, self.vz) < 0.5) this.telemetry.counterStrafeSuccesses++;
    }
    if (this.pendingMistake) {
      this.telemetry.mistakes.push(this.pendingMistake);
      if (this.telemetry.mistakes.length > 40) this.telemetry.mistakes.shift();
      this.pendingMistake = null;
    }
  }
}

export { tierOf } from './personality';
export type { Personality } from './personality';
