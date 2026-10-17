import {
  ProtocolCatalog, decodeSnapshot, type GameEvent, type GameMap,
  type NetPlayer, type NetSnapshot, type Team,
} from '@tactical/shared';
import type { DataBundle } from '../data';
import type { OfflineOptions, RosterEntry } from '../sim/protocol';
import type { ClientSession } from '../sim/client-session';
import { Predictor } from '../sim/prediction';
import { InputManager } from './input';
import type { ProfileStore, ClientSettings } from './store';
import { buildMapVisual, type MapVisual } from '../render/mapMesh';
import { CharacterManager, type RenderPlayer } from '../render/characters';
import { EffectsManager } from '../render/effects';
import { ViewModel } from '../render/viewmodel';
import { PRESETS, type RendererHost } from '../render/renderer';
import type { AssetLoader } from '../assets/loader';
import type { AudioSystem } from '../audio/audio';
import type { Hud } from '../ui/hud';
import type { Menus } from '../ui/menus';
import type { SkinDef } from '../render/skins';

interface HistoryEntry { tick: number; snap: NetSnapshot }

export interface GameViewCallbacks {
  onExit: () => void;
  onPause: () => void;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class GameView {
  private map: GameMap | null = null;
  private visual: MapVisual | null = null;
  private characters: CharacterManager | null = null;
  private effects: EffectsManager | null = null;
  private viewmodel: ViewModel | null = null;
  private predictor: Predictor | null = null;
  private catalog: ProtocolCatalog | null = null;
  private history: HistoryEntry[] = [];
  private latest: NetSnapshot | null = null;
  private roster: RosterEntry[] = [];
  private youId = 0;
  private seq = 0;
  private acc = 0;
  private lastFrame = 0;
  private running = false;
  private raf = 0;
  private options: OfflineOptions | null = null;
  private correction = { x: 0, y: 0, z: 0 };
  private currentWeapon = '';
  private lastPhase = '';
  private shotCooldown = 0;
  private sessionKills = 0;
  private sessionDeaths = 0;
  private sessionHeadshots = 0;
  private sessionDamage = 0;
  private matchEndTimer = 0;
  private paused = false;
  private spectating = false;
  private spectateId: number | null = null;
  private cameraShake = 0;
  private lastCaptionAt = 0;
  private landingVelocity = 0;
  private footstepTimer = 0;
  private lastSelfHealth = 100;
  private chatMode: 'team' | 'all' | null = null;
  private keybinds: Record<string, string>;
  private disposed = false;

  constructor(
    private readonly host: RendererHost,
    private readonly bundle: DataBundle,
    private readonly assets: AssetLoader,
    private readonly audio: AudioSystem,
    private readonly settings: ClientSettings,
    private readonly profile: ProfileStore,
    private readonly hud: Hud,
    private readonly menus: Menus,
    private readonly input: InputManager,
    private readonly session: ClientSession,
    private readonly cb: GameViewCallbacks,
  ) {
    this.keybinds = settings.keybinds;
    this.input.onKeyAction = (action) => this.onKeyAction(action);
    window.addEventListener('keydown', this.buyKeys);
    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.running && !this.hud.isBuyOpen && !this.paused) this.pause();
    };
    session.onSnapshot = (snap) => this.onSnapshot(snap);
    session.onError = (msg) => { this.menus.toast(msg, true); this.cb.onExit(); };
    session.onBuyResult = (ok, _id, reason) => {
      this.hud.setBuyMessage(ok ? 'ĐÃ MUA' : (reason === 'money' ? 'KHÔNG ĐỦ TIỀN' : reason === 'phase' ? 'NGOÀI THỜI GIAN MUA' : 'KHÔNG THỂ MUA'), !ok);
    };
    session.onMatchEnd = (winner) => this.finishMatch(winner);
    session.onChat = (from, text, team, bot) => {
      this.hud.chat(`${bot ? '[BOT] ' : ''}${from}${team === 'all' ? '' : ' (đội)'}: ${text}`, 'sys');
    };
    session.onRoster = (roster) => this.applyRoster(roster);
    session.onReady = (info) => {
      if (!this.running) return;
      this.youId = info.youId;
      this.applyRoster(info.roster);
    };
    session.onState = (state, detail) => {
      if (state === 'reconnecting') this.menus.toast(`Mất kết nối — đang thử lại. ${detail ?? ''}`, true);
      else if (state === 'open' && this.running) this.menus.toast('Đã kết nối lại máy chủ.', false);
    };
  }

  async start(options: OfflineOptions): Promise<void> {
    this.disposeWorld();
    this.options = options;
    this.disposed = false;
    this.map = this.bundle.maps[options.mapId] ?? this.bundle.maps.sandstorm!;
    this.catalog = new ProtocolCatalog(this.bundle.data);
    this.buildWorld(this.map);
    this.hud.setMap(this.map);
    this.audio.play('ui_click');
    this.host.applyEnvironment(this.map.json.environment, this.map.json.lights[0]?.direction ?? this.map.json.environment.sunDirection);
    const preset = PRESETS[this.settings.graphics.preset] ?? PRESETS.high;
    this.host.applyPreset(this.settings.graphics.preset);
    this.effects?.setSmokeLayers(preset.smokeLayers);
    this.host.setFov(this.settings.fov);
    this.input.yaw = options.team === 'T' ? Math.PI / 2 : -Math.PI / 2;
    this.input.pitch = 0;
    this.input.grenadeSlot = 0;
    this.input.enabled = options.replay === undefined;
    this.seq = 0;
    this.history = [];
    this.latest = null;
    this.sessionKills = 0; this.sessionDeaths = 0; this.sessionHeadshots = 0; this.sessionDamage = 0;
    this.paused = false;
    this.spectating = false;
    this.menus.hideAll();
    this.menus.hidePause();
    this.menus.hideResults();
    this.hud.setVisible(true);
    this.hud.resetMatch();
    this.menus.gameActive = true;
    this.hud.showBanner(options.replay ? 'REPLAY' : 'TRIỂN KHAI', options.replay ? 'PHÁT LẠI TRẬN ĐẤU · KHÔNG NHẬN INPUT' : 'CHUẨN BỊ VÀO TRẬN', 1600);
    if (options.replay) this.hud.chat('Chế độ xem lại: mô phỏng chạy lại từ seed và input đã ghi.', 'sys');
    const ready = await this.session.start(options, (buf) => decodeSnapshot(new Uint8Array(buf), null, this.catalog!));
    this.youId = ready.youId;
    this.roster = ready.roster;
    this.hud.setRoster(this.roster);
    this.hud.chat(`Trận đấu ${options.mode.toUpperCase()} · ${this.map.json.name} · ${options.botsPerSide}v${options.botsPerSide}`, 'sys');
    this.hud.chat('Bot được gắn nhãn BOT. Nhấn TAB để xem bảng điểm, B để mua.', 'sys');
    this.matchFinished = false;
    this.running = true;
    this.lastFrame = performance.now();
    this.acc = 0;
    this.loop();
    if (options.replay === undefined) this.input.requestLock();
  }

  private buildWorld(map: GameMap): void {
    this.visual = buildMapVisual(map, this.assets);
    this.host.scene.add(this.visual.group);
    this.characters = new CharacterManager(this.host.scene, this.bundle.data);
    this.effects = new EffectsManager(this.host.scene, this.assets, PRESETS[this.settings.graphics.preset].smokeLayers);
    this.viewmodel = new ViewModel(this.host, this.bundle.data);
    this.predictor = new Predictor(this.bundle.data, map, this.options?.team ?? 'T');
    this.host.camera.position.set(0, 3, 0);
  }

  private disposeWorld(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.session) this.session.destroy();
    this.characters?.dispose();
    this.effects?.dispose();
    this.viewmodel?.dispose();
    if (this.visual) { this.host.scene.remove(this.visual.group); this.visual.dispose(); this.visual = null; }
    this.host.viewCamera.clear();
    this.characters = null; this.effects = null; this.viewmodel = null; this.predictor = null;
    this.history = []; this.latest = null; this.hud.setVisible(false);
    this.menus.hidePause();
  }

  private onKeyAction(action: string): void {
    if (!this.running) return;
    if (action === 'buy') {
      if (this.options?.replay !== undefined) return;
      if (this.hud.isBuyOpen) this.closeBuy();
      else this.openBuy();
    } else if (action === 'scoreboard_on') this.hud.toggleScoreboard(true);
    else if (action === 'scoreboard_off') this.hud.toggleScoreboard(false);
    else if (action === 'pause') this.pause();
    else if (action === 'debug') this.hud.toggleDebug(true, 'DEBUG');
    else if (action === 'chat_team' || action === 'chat_all') { if (this.options?.replay === undefined) this.beginChat(action === 'chat_all'); }
    else if (action === 'radio') this.hud.chat('Radio: cần hỗ trợ!', 'sys');
    else if (action === 'grenade_cycle') this.hud.setBuyMessage('');
  }

  private openBuy(): void {
    if (!this.latest) return;
    this.hud.setBuyOpen(true);
    this.hud.setBuyMoney(this.latest.self.money);
    this.input.setEnabled(false);
    this.input.releaseLock();
  }

  closeBuy(): void {
    this.hud.setBuyOpen(false);
    this.input.setEnabled(true);
    this.input.requestLock();
  }

  private readonly buyKeys = (e: KeyboardEvent): void => {
    if (!this.hud.isBuyOpen) return;
    if (e.code === 'KeyB' || e.code === 'Escape') { e.preventDefault(); this.closeBuy(); }
  };

  private beginChat(all: boolean): void {
    this.chatMode = all ? 'all' : 'team';
    this.input.setEnabled(false);
    this.input.releaseLock();
    const input = this.hud.showChatInput(all ? 'Nhập tin nhắn cho tất cả…' : 'Nhập tin nhắn cho đội…');
    if (!input) return;
    const done = (send: boolean): void => {
      const text = input.value.trim().slice(0, 120);
      input.onkeydown = null;
      input.onblur = null;
      this.hud.hideChatInput();
      this.chatMode = null;
      if (send && text) {
        if (!this.session.online) this.hud.chat(`${this.profile.value.name}: ${text}`, 'sys');
        this.session.chat(text, this.chatMode === 'team');
      }
      this.input.setEnabled(true);
      this.input.requestLock();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    };
    input.onblur = () => done(false);
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.input.setEnabled(false);
    this.input.releaseLock();
    this.session.pause();
    const score = this.latest ? `${this.latest.round.scoreT} : ${this.latest.round.scoreCT} · ROUND ${this.latest.round.roundNumber}` : '';
    this.menus.showPause(score);
  }

  resume(): void {
    this.paused = false;
    this.menus.hidePause();
    this.input.setEnabled(true);
    this.input.requestLock();
    this.session.resume();
  }

  buy(itemId: string): void {
    if (!itemId) return;
    this.session.buy(itemId);
    this.audio.play('buy');
  }

  private fireInputTick(input: { buttons: number; forward: number }): void {
    const ammo = this.latest?.self.ammo ?? 0;
    if ((input.buttons & 1) && ammo > 0 && this.shotCooldown <= 0) {
      this.viewmodel?.pulseFire();
      this.shotCooldown = 1;
      this.cameraShake = Math.min(0.6, this.cameraShake + 0.12);
    }
  }

  private onSnapshot(snap: NetSnapshot): void {
    this.history.push({ tick: snap.tick, snap });
    while (this.history.length > 48) this.history.shift();
    this.latest = snap;
    if (!this.predictor || !this.catalog) return;
    const dm = snap.self;
    // hoà giải vị trí dự đoán
    const oldX = this.predictor.state.x, oldZ = this.predictor.state.z;
    const err = this.predictor.reconcile(dm, snap.round.phase, snap.ackSeq);
    const dx = this.predictor.state.x - oldX, dz = this.predictor.state.z - oldZ;
    this.correction.x = Math.max(-0.8, Math.min(0.8, this.correction.x - dx));
    this.correction.z = Math.max(-0.8, Math.min(0.8, this.correction.z - dz));
    if (err > 2) { this.correction.x = 0; this.correction.z = 0; }
    const wid = this.bundle.data.weaponsList[dm.weaponIdx]?.id ?? 'knife';
    if (wid !== this.currentWeapon) {
      this.currentWeapon = wid;
      const equipped = this.profile.equippedFor(wid);
      const def = equipped ? (this.bundle.skins.skins as SkinDef[]).find((s) => s.id === equipped.skinId) : undefined;
      this.viewmodel?.setWeapon(wid, def && equipped ? { def, inst: equipped } : null);
    }
    if (dm.health < this.lastSelfHealth) {
      const dmg = this.lastSelfHealth - dm.health;
      if (dmg > 0.5) { this.hud.damage(dmg < 5 ? 5 : dmg); this.audio.play('hit'); this.cameraShake = Math.min(0.9, this.cameraShake + dmg / 120); }
    }
    this.lastSelfHealth = dm.health;
    if (!dm.alive && !this.spectating && snap.round.phase !== 'matchEnd') {
      this.spectating = true;
      this.spectateId = null;
    }
    if (dm.alive) this.spectating = false;
    this.handleEvents(snap);
    this.hud.update(snap);
    this.effects?.syncSmokes(snap.smokes, snap.tick);
    this.effects?.syncFires(snap.fires, snap.tick);
    this.effects?.setBomb(snap.round.bombPlanted && snap.round.phase === 'live', snap.round.bombX, snap.round.bombY, snap.round.bombZ, Math.max(0, (snap.round.bombTimerEndTick - snap.tick) / 64));
    if (snap.round.phase !== this.lastPhase) {
      if (snap.round.phase === 'live') this.audio.play('round_start');
      if (snap.round.phase === 'over') this.audio.play((snap.round.winner === 0 ? 'T' : 'CT') === this.selfTeam ? 'round_win' : 'round_lose');
      this.lastPhase = snap.round.phase;
    }
    // hồi sinh/round mới: đặt lại vị trí dự đoán đã làm ở reconcile
  }

  private get selfTeam(): Team {
    return this.roster.find((r) => r.id === this.youId)?.team ?? 'T';
  }

  private handleEvents(snap: NetSnapshot): void {
    const selfId = snap.self.id;
    for (const e of snap.events) {
      this.handleEvent(e, snap, selfId);
    }
  }

  private handleEvent(e: GameEvent, snap: NetSnapshot, selfId: number): void {
    const wname = (id: string): string => this.bundle.data.weapons.get(id)?.displayName ?? id;
    switch (e.type) {
      case 'shot': {
        const w = this.bundle.data.weapons.get(e.weapon);
        const sound = w?.category === 'sniper' ? 'sniper' : w?.category === 'smg' ? 'smg' : w?.category === 'pistol' ? 'pistol' : w?.category === 'shotgun' ? 'shotgun' : 'rifle';
        if (e.playerId === selfId) {
          this.audio.play(sound, { volume: 1 });
        } else {
          this.audio.play(sound, { pos: { x: e.x, y: e.y, z: e.z }, volume: 0.9 });
          this.effects?.handleEvent(e, selfId);
          this.captionSound(snap, e.x, e.z, 'Tiếng súng');
          const shooter = snap.players.find((p) => p.id === e.playerId);
          if (shooter) this.hud.addEnemyPing(shooter);
        }
        break;
      }
      case 'hit':
        if (e.attacker === selfId) {
          this.hud.hitmarker(e.group === 'head', e.lethal);
          this.audio.play(e.group === 'head' ? 'headshot' : 'hit');
          this.sessionDamage += e.damage;
        }
        if (e.victim === selfId) this.hud.damage(e.damage);
        this.effects?.handleEvent(e, selfId);
        break;
      case 'kill':
        this.hud.feedKill(e);
        if (e.attacker === selfId) {
          this.sessionKills++;
          if (e.headshot) this.sessionHeadshots++;
          this.audio.play('kill');
        }
        if (e.victim === selfId) {
          this.sessionDeaths++;
          this.audio.play('hit');
          this.cameraShake = 0.7;
          this.spectating = true;
          this.viewmodel?.setScoped(false);
        }
        break;
      case 'reload_start':
        if (e.playerId === selfId) { this.viewmodel?.startReload(e.durationSec); this.audio.play('reload_start'); }
        else this.audio.play('reload_start', { pos: { x: 0, y: 0, z: 0 }, volume: 0.2 });
        break;
      case 'reload_end':
        if (e.playerId === selfId) this.audio.play('reload_end');
        break;
      case 'weapon_switch':
        if (e.playerId === selfId) this.audio.play('ui_click');
        break;
      case 'scope':
        if (e.playerId === selfId) this.audio.play('scope');
        break;
      case 'footstep': {
        if (e.playerId === selfId) break;
        this.audio.play('footstep', { pos: { x: e.x, y: e.y, z: e.z }, volume: 0.5 });
        this.captionSound(snap, e.x, e.z, 'Bước chân');
        break;
      }
      case 'impact':
        this.effects?.handleEvent(e, selfId);
        break;
      case 'bomb_beep':
        this.audio.play('bomb_beep', { pos: { x: e.x, y: e.y, z: e.z }, volume: 0.7 });
        this.captionSound(snap, e.x, e.z, 'Tiếng bom kêu');
        break;
      case 'bomb_planted':
        this.audio.play('bomb_planted');
        this.hud.showBanner('BOMB ĐÃ ĐẶT', `SITE ${e.site} · 40 GIÂY`, 2000);
        this.hud.chat(`Bomb được đặt tại site ${e.site}`, 'sys');
        break;
      case 'bomb_defused':
        this.audio.play('bomb_defused');
        this.hud.showBanner('BOMB ĐÃ GỠ', 'CT GIÀNH CHIẾN THẮNG VÒNG', 2000);
        break;
      case 'bomb_exploded':
        this.effects?.explosion(e.x, e.y, e.z, true);
        this.audio.play('explosion', { pos: { x: e.x, y: e.y, z: e.z }, volume: 1 });
        this.cameraShake = 1;
        break;
      case 'grenade_explode':
        this.audio.play(e.kind === 'flash' ? 'flashbang' : 'explosion', { pos: { x: e.x, y: e.y, z: e.z }, volume: 0.85 });
        this.effects?.handleEvent(e, selfId);
        break;
      case 'flash':
        this.audio.play('flashbang', { pos: { x: e.x, y: e.y, z: e.z }, volume: 0.8 });
        this.effects?.handleEvent(e, selfId);
        break;
      case 'smoke_start':
        this.audio.play('smoke_deploy', { pos: { x: e.x, y: e.y, z: e.z }, volume: 0.6 });
        break;
      case 'grenade_throw':
        this.audio.play('grenade_throw', { pos: { x: 0, y: 0, z: 0 }, volume: 0.3 });
        break;
      case 'round_start':
        this.hud.chat(`Vòng ${e.round} bắt đầu`, 'sys');
        break;
      case 'round_end':
        this.audio.play(e.winner === this.selfTeam ? 'round_win' : 'round_lose');
        this.hud.showBanner(e.winner === this.selfTeam ? 'VÒNG THẮNG' : 'VÒNG THUA', `${e.reason.toUpperCase()} · ${e.scoreT}:${e.scoreCT}`, 2400);
        break;
      case 'match_end':
        this.finishMatch(e.winner);
        break;
      case 'chat':
      case 'radio':
        this.hud.chat(`${this.roster.find((r) => r.id === e.playerId)?.name ?? '?'}: ${e.text}`, 'sys');
        break;
      case 'dryfire':
        if (e.playerId === selfId) this.audio.play('dryfire');
        break;
      case 'plant_start':
      case 'defuse_start':
        this.audio.play('reload_start');
        break;
      case 'pickup':
        if (e.playerId === selfId) this.hud.chat(`Đã nhặt ${wname(e.itemId)}`, 'sys');
        break;
      case 'buy':
        if (e.playerId === selfId) this.hud.chat(`Đã mua ${wname(e.itemId)}`, 'sys');
        break;
      default:
        break;
    }
  }

  private matchFinished = false;

  private finishMatch(winner: Team): void {
    if (!this.running || this.matchFinished) return;
    this.matchFinished = true;
    this.matchEndTimer = window.setTimeout(() => {
      const snap = this.latest;
      const scoreT = snap?.round.scoreT ?? 0;
      const scoreCT = snap?.round.scoreCT ?? 0;
      const won = winner === this.selfTeam;
      this.menus.showResults({
        won, scoreT, scoreCT,
        kills: this.sessionKills, deaths: this.sessionDeaths,
        headshots: this.sessionHeadshots, damage: this.sessionDamage,
      });
      if (this.options?.replay === undefined) {
        this.profile.addStats({ matches: 1, wins: won ? 1 : 0, kills: this.sessionKills, deaths: this.sessionDeaths, headshots: this.sessionHeadshots, damage: this.sessionDamage });
      }
      this.input.setEnabled(false);
      this.input.releaseLock();
      this.session.pause();
      this.menus.refreshProfile();
      this.audio.play(won ? 'round_win' : 'round_lose');
    }, 1600);
  }

  restart(): void {
    if (!this.options) return;
    const opts = this.options;
    this.session.destroy();
    void this.start(opts);
  }

  quit(): void {
    this.menus.gameActive = false;
    this.disposeWorld();
    this.menus.show('main');
    this.cb.onExit();
  }

  private captionSound(snap: NetSnapshot, x: number, z: number, label: string): void {
    if (!this.settings.accessibility.subtitles) return;
    const now = performance.now();
    if (now - this.lastCaptionAt < 350) return;
    const dx = x - snap.self.x, dz = z - snap.self.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 45) return;
    this.lastCaptionAt = now;
    let rel = Math.atan2(dx, dz) - snap.self.yaw;
    rel = ((rel + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const deg = (rel * 180) / Math.PI;
    const dir = Math.abs(deg) < 45 ? 'phía trước' : Math.abs(deg) > 135 ? 'phía sau' : deg > 0 ? 'bên phải' : 'bên trái';
    this.hud.caption(`${label} · ${dir} · ${Math.round(dist)}m`);
  }

  private applyRoster(roster: RosterEntry[]): void {
    this.roster = roster;
    this.hud.setRoster(roster);
  }

  private interpolate(tick: number): NetSnapshot | null {
    if (this.history.length === 0) return null;
    if (this.history.length === 1) return this.history[0]!.snap;
    if (tick <= this.history[0]!.tick) return this.history[0]!.snap;
    for (let i = this.history.length - 1; i >= 1; i--) {
      const a = this.history[i - 1]!, b = this.history[i]!;
      if (tick >= a.tick && tick <= b.tick) {
        return this.blend(a.snap, b.snap, (tick - a.tick) / Math.max(1, b.tick - a.tick));
      }
    }
    return this.history[this.history.length - 1]!.snap;
  }

  private blend(a: NetSnapshot, b: NetSnapshot, t: number): NetSnapshot {
    const players = b.players.map((pb) => {
      const pa = a.players.find((p) => p.id === pb.id);
      if (!pa) return pb;
      return {
        ...pb,
        x: pa.x + (pb.x - pa.x) * t,
        y: pa.y + (pb.y - pa.y) * t,
        z: pa.z + (pb.z - pa.z) * t,
        yaw: lerpAngle(pa.yaw, pb.yaw, t),
        pitch: pa.pitch + (pb.pitch - pa.pitch) * t,
      } as NetPlayer;
    });
    return { ...b, players };
  }

  private renderPlayers(snap: NetSnapshot, dt: number): void {
    if (!this.characters) return;
    const renderTick = snap.tick - 3;
    const interp = this.interpolate(renderTick) ?? snap;
    const list: RenderPlayer[] = [];
    for (const p of interp.players) {
      if (p.id === this.youId && p.alive) continue;
      list.push({
        id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
        health: p.health, armor: p.armor, alive: p.alive, crouching: p.crouching,
        walking: p.walking, team: p.team, bot: p.bot,
        weaponId: this.bundle.data.weaponsList[p.weaponIdx]?.id ?? 'knife',
        scoped: p.scoped,
        name: this.roster.find((r) => r.id === p.id)?.name ?? `#${p.id}`,
      });
    }
    this.characters.sync(list, dt, this.youId);
  }

  private updateCamera(snap: NetSnapshot, dt: number): void {
    const p = this.predictor;
    this.correction.x *= Math.exp(-dt * 14);
    this.correction.z *= Math.exp(-dt * 14);
    this.correction.y *= Math.exp(-dt * 14);
    const dm = snap.self;
    const team = this.selfTeam;
    let eyeX = dm.x, eyeY = dm.y + (dm.crouching ? 1.16 : 1.64), eyeZ = dm.z;
    if (p && dm.alive) {
      eyeX = p.state.x;
      eyeY = p.state.eyeY;
      eyeZ = p.state.z;
    } else if (!dm.alive && this.spectating) {
      const mate = snap.players.find((q) => q.alive && q.team === team && q.id !== this.youId);
      if (mate) {
        eyeX = mate.x + this.correction.x * 0.4;
        eyeY = mate.y + (mate.crouching ? 1.16 : 1.64);
        eyeZ = mate.z + this.correction.z * 0.4;
      }
    }
    this.cameraShake = Math.max(0, this.cameraShake - dt * 2.2);
    const shake = this.settings.gameplay.reducedMotion ? 0 : this.cameraShake * 0.012;
    const t = Math.min(1, dt * 18);
    this.host.camera.position.x += (eyeX + this.correction.x + (Math.random() - 0.5) * shake - this.host.camera.position.x) * t;
    this.host.camera.position.y += (eyeY + this.correction.y - this.host.camera.position.y) * t;
    this.host.camera.position.z += (eyeZ + this.correction.z + (Math.random() - 0.5) * shake - this.host.camera.position.z) * t;
    const wantYaw = this.input.yaw;
    const wantPitch = this.input.pitch;
    this.host.camera.rotation.order = 'YXZ';
    this.host.camera.rotation.y = wantYaw + Math.PI;
    this.host.camera.rotation.x = wantPitch;
    const w = this.bundle.data.weapons.get(this.currentWeapon);
    const scopedNow = dm.scoped && !!w && w.scopeFov > 0;
    this.viewmodel?.setScoped(scopedNow);
    const targetFov = scopedNow && w ? w.scopeFov : this.settings.fov;
    this.host.camera.fov += (targetFov - this.host.camera.fov) * Math.min(1, dt * 18);
    this.host.camera.updateProjectionMatrix();
    this.audio.updateListener({ x: this.host.camera.position.x, y: this.host.camera.position.y, z: this.host.camera.position.z }, wantYaw);
    this.host.viewCamera.fov = this.settings.fov * 0.68;
    this.host.viewCamera.updateProjectionMatrix();
    void this.landingVelocity;
  }

  private updateViewModel(dt: number, snap: NetSnapshot): void {
    if (!this.viewmodel) return;
    const p = this.predictor?.state;
    const speed = p ? Math.hypot(p.vx, p.vz) : Math.hypot(snap.self.vx, snap.self.vz);
    this.viewmodel.update(dt, {
      speed,
      grounded: snap.self.grounded,
      yaw: this.input.yaw,
      pitch: this.input.pitch,
      crouching: snap.self.crouching,
      reloading: snap.self.reloading,
      alive: snap.self.alive,
    });
  }

  private stepInput(): void {
    if (!this.latest || !this.predictor) return;
    const phase = this.latest.round.phase;
    const raw = this.input.enabled && !this.paused ? this.input.sample() : { forward: 0, right: 0, yaw: this.input.yaw, pitch: this.input.pitch, buttons: 0, grenadeSlot: 0 };
    const cmd = {
      seq: ++this.seq,
      tick: this.latest.tick,
      forward: raw.forward, right: raw.right, yaw: raw.yaw, pitch: raw.pitch,
      buttons: raw.buttons, grenadeSlot: raw.grenadeSlot,
    };
    this.session.sendInput(cmd);
    this.predictor.apply({ ...cmd, dt: 1 / 64, viewTick: this.latest.tick }, phase);
    this.fireInputTick(raw);
    this.shotCooldown = Math.max(0, this.shotCooldown - 1);
    if (this.chatMode) return;
  }

  private loop = (): void => {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.2) dt = 0.2;
    if (!this.paused) {
      this.acc += dt;
      const step = 1 / 64;
      let steps = 0;
      while (this.acc >= step && steps < 4) {
        this.stepInput();
        this.acc -= step;
        steps++;
      }
    }
    const snap = this.latest;
    if (snap) {
      this.renderPlayers(snap, dt);
      this.updateCamera(snap, dt);
      this.updateViewModel(dt, snap);
      this.effects?.update(dt);
    }
    this.host.render();
    if (snap && this.settings.hud.showFps) {
      this.hud.toggleDebug(this.settings.hud.showFps, `FPS ${this.host.averageFps.toFixed(0)} · ${this.host.backend.toUpperCase()} · ${this.host.frameMs.toFixed(2)}ms\nTICK ${snap.tick} · PING ${this.session.latencyMs}ms\nPOS ${snap.self.x.toFixed(1)} ${snap.self.y.toFixed(1)} ${snap.self.z.toFixed(1)}`);
    }
  };

  currentOptions(): OfflineOptions | null { return this.options; }

  refreshCosmetics(): void { this.currentWeapon = ''; }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.buyKeys);
    window.clearTimeout(this.matchEndTimer);
    this.disposeWorld();
  }
}
