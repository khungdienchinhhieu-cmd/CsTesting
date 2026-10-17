import type { DataBundle } from '../data';
import type { RosterEntry } from '../sim/protocol';
import type { NetPlayer, NetSnapshot, GameEvent, GameMap } from '@tactical/shared';
import type { ClientSettings } from '../game/store';

export interface HudCallbacks {
  onReplaySpeed?: (speed: number) => void;
  onReplayToggle?: () => void;
  onReplayExit?: () => void;
  onBuy: (itemId: string) => void;
  onCloseBuy: () => void;
}

interface KillEntry { attacker: number | null; victim: number; weapon: string; headshot: boolean; at: number }

const CAT_LABELS: Record<string, string> = {
  pistols: 'SÚNG NGẮN', smgs: 'SMG', heavy: 'HẠNG NẶNG', gear: 'TRANG BỊ', grenades: 'LỰU ĐẠN',
};

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  readonly root: HTMLDivElement;
  private map: GameMap;
  private readonly data: DataBundle;
  private roster: RosterEntry[] = [];
  private scores = new Map<number, { kills: number; deaths: number }>();
  private killfeed: KillEntry[] = [];
  private spotted = new Map<number, number>();
  private buyOpen = false;
  private scoreboardOpen = false;
  private bannerTimer = 0;
  private lastPhase = '';
  private lastRound = -1;
  private hitEl!: HTMLElement;
  private hitTimer = 0;
  private pingTimer = 0;
  private captionTimer = 0;
  private radarCtx: CanvasRenderingContext2D | null = null;
  private isScoped = false;
  private settings: ClientSettings;
  private readonly buyItems: { id: string; name: string; price: number; cat: string }[] = [];

  constructor(root: HTMLElement, bundle: DataBundle, settings: ClientSettings, map: GameMap, private readonly cb: HudCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    root.appendChild(this.root);
    this.data = bundle;
    this.settings = settings;
    this.map = map;
    this.buyItems = this.buildBuyItems();
    this.root.innerHTML = `
      <div class="vignette"></div>
      <div class="damage-overlay" id="hud-damage"></div>
      <div class="flash-overlay" id="hud-flash"></div>
      <div class="topbar">
        <div class="team-score t"><span>T</span><b id="score-t">0</b></div>
        <div class="match-clock" id="match-clock"><b id="clock-time">1:55</b><span id="clock-label">ROUND 1</span></div>
        <div class="team-score ct"><span>CT</span><b id="score-ct">0</b></div>
      </div>
      <div class="round-tag" id="round-tag">BEST OF 24 · MR12</div>
      <div class="objective" id="objective" style="display:none"><span id="objective-text">BOMB</span><div class="bar"><i id="objective-fill"></i></div></div>
      <div class="killfeed" id="killfeed"></div>
      <div class="subtitles" id="subtitles" aria-live="polite"></div>
      <div class="replay-bar" id="replay-bar" style="display:none">
        <span class="rb-tag">REPLAY</span>
        <button data-rspeed="0.5">0.5×</button>
        <button data-rspeed="1" class="on">1×</button>
        <button data-rspeed="2">2×</button>
        <button data-rspeed="4">4×</button>
        <button data-rtoggle id="rb-toggle">II</button>
        <button data-rexit>✕</button>
      </div>
      <div class="radar-wrap"><canvas id="radar"></canvas><div class="radar-label">TACTICAL</div></div>
      <div class="vitals">
        <div class="vital" id="vital-hp"><span class="icon">HP</span><span class="num" id="hp-num">100</span><div class="bar"><i id="hp-bar"></i></div></div>
        <div class="vital" id="vital-armor"><span class="icon">AR</span><span class="num" id="armor-num">0</span><div class="bar"><i id="armor-bar"></i></div></div>
      </div>
      <div class="money" id="money">800</div>
      <div class="loadout-mini" id="loadout-mini">PISTOL</div>
      <div class="ammo-box">
        <div class="weapon" id="ammo-weapon">PISTOL</div>
        <div class="ammo" id="ammo"><span id="ammo-mag">12</span><small id="ammo-reserve"> / 36</small></div>
        <div class="nades" id="nades"></div>
      </div>
      <div class="bomb-hint" id="bomb-hint">GIỮ E ĐỂ ĐẶT BOM</div>
      <div class="crosshair" id="crosshair"><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><i class="dot"></i></div>
      <div class="hitmarker" id="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="scope-overlay" id="scope"><div class="scope-ring"></div></div>
      <div class="spectate" id="spectate">BẠN ĐÃ CHẾT · <b id="spectate-target">ĐANG CHỜ VÒNG SAU</b></div>
      <div class="round-banner" id="banner"><h2 id="banner-title">ROUND 1</h2><p id="banner-sub">MUA SẮM</p></div>
      <div class="chat-log" id="chat"></div>
      <div class="text-entry" id="text-entry"><input id="chat-input" maxlength="120" placeholder="Nhập tin nhắn…" /></div>
      <div class="buy-menu" id="buy-menu">
        <div class="buy-head"><h2>// MUA SẮM</h2><div style="display:flex;gap:18px;align-items:center"><span class="buy-msg" id="buy-msg"></span><span class="cash" id="buy-cash">◆ 800</span><button class="btn ghost" style="padding:5px 10px" id="buy-close">ĐÓNG [B]</button></div></div>
        <div class="buy-body" id="buy-body"></div>
        <div class="buy-foot"><span>Chỉ mua trong thời gian freeze. Tiền không đủ sẽ bị từ chối.</span><span>Credits không phải tiền thật</span></div>
      </div>
      <div class="scoreboard" id="scoreboard"><div class="sb-panel">
        <div class="sb-head"><b>TACTICAL STRIKE</b><span id="sb-sub">MR12 · SANDSTORM</span></div>
        <div id="sb-teams"></div>
      </div></div>
      <div class="debug-panel" id="debug"></div>
      <div class="build-badge">BUILD 0.1.0 · SHARED SIM 64Hz</div>
      <div class="placeholder-badge">ART: PROCEDURAL PLACEHOLDER</div>`;
    this.root.querySelector('#buy-close')?.addEventListener('click', () => { this.cb.onCloseBuy(); });
    const radar = this.root.querySelector<HTMLCanvasElement>('#radar');
    this.radarCtx = radar?.getContext('2d') ?? null;
    this.hitEl = this.root.querySelector('#hitmarker') as HTMLElement;
    this.applySettings(settings);
  }

  private buildBuyItems(): { id: string; name: string; price: number; cat: string }[] {
    const out: { id: string; name: string; price: number; cat: string }[] = [];
    const menu = this.data.data.buyMenu;
    for (const [cat, ids] of Object.entries(menu)) {
      for (const id of ids) {
        const item = this.data.data.buyItem(id);
        if (!item) continue;
        let name = id;
        if (item.kind === 'weapon') name = this.data.data.weapon(id).displayName;
        else if (item.kind === 'grenade') name = this.data.data.grenade(id as never).displayName;
        else name = this.data.data.equipment.get(id)?.displayName ?? id;
        out.push({ id, name, price: item.price, cat });
      }
    }
    return out;
  }

  setRoster(roster: RosterEntry[]): void {
    this.roster = roster;
    this.scores.clear();
    for (const r of roster) this.scores.set(r.id, { kills: 0, deaths: 0 });
  }

  setMap(map: GameMap): void { this.map = map; }

  setVisible(v: boolean): void { this.root.classList.toggle('active', v); }

  showReplayBar(show: boolean): void {
    const bar = this.root.querySelector('#replay-bar') as HTMLElement | null;
    if (!bar) return;
    bar.style.display = show ? 'flex' : 'none';
    if (!show) return;
    bar.querySelectorAll<HTMLButtonElement>('[data-rspeed]').forEach((b) => {
      b.onclick = () => {
        const speed = Number(b.dataset.rspeed);
        bar.querySelectorAll('[data-rspeed]').forEach((x) => x.classList.toggle('on', x === b));
        this.cb.onReplaySpeed?.(speed);
      };
    });
    (bar.querySelector('[data-rtoggle]') as HTMLButtonElement | null)?.addEventListener('click', () => this.cb.onReplayToggle?.());
    (bar.querySelector('[data-rexit]') as HTMLButtonElement | null)?.addEventListener('click', () => this.cb.onReplayExit?.());
  }

  setReplayPaused(paused: boolean): void {
    const btn = this.root.querySelector('#rb-toggle');
    if (btn) btn.textContent = paused ? '▶' : 'II';
  }

  applySettings(s: ClientSettings): void {
    this.settings = s;
    const ch = this.root.querySelector('#crosshair') as HTMLElement;
    if (ch) {
      ch.style.setProperty('--gap', `${s.hud.crosshair.gap}px`);
      ch.style.setProperty('--len', `${s.hud.crosshair.size}px`);
      ch.style.setProperty('--thick', `${s.hud.crosshair.thickness}px`);
      ch.style.setProperty('--color', s.hud.crosshair.color);
      (ch.querySelector('.dot') as HTMLElement).style.display = s.hud.crosshair.dot ? 'block' : 'none';
    }
    this.root.dataset.colorBlind = s.accessibility.colorBlind;
    this.root.classList.toggle('high-contrast', s.accessibility.highContrast);
    this.root.style.setProperty('--hud-scale', String(s.accessibility.uiScale));
  }

  /** Phụ đề âm thanh cho người khiếm thính (hướng tương đối + loại âm). */
  caption(text: string, ms = 1800): void {
    if (!this.settings.accessibility.subtitles) return;
    const el = this.root.querySelector('#subtitles') as HTMLElement | null;
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    window.clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => el.classList.remove('on'), Math.max(400, ms));
  }

  private nameOf(id: number | null): string {
    if (id === null) return 'WORLD';
    const r = this.roster.find((x) => x.id === id);
    return r ? r.name : `#${id}`;
  }

  private teamOf(id: number | null): 'T' | 'CT' {
    if (id === null) return 'T';
    return this.roster.find((x) => x.id === id)?.team ?? 'T';
  }

  feedKill(e: Extract<GameEvent, { type: 'kill' }>): void {
    this.killfeed.unshift({ attacker: e.attacker, victim: e.victim, weapon: e.weapon, headshot: e.headshot, at: performance.now() });
    if (this.killfeed.length > 5) this.killfeed.pop();
    const score = (id: number | null): void => {
      if (id === null) return;
      const s = this.scores.get(id);
      if (s) s.kills++;
    };
    score(e.attacker);
    const victimScore = this.scores.get(e.victim);
    if (victimScore) victimScore.deaths++;
    this.renderKillfeed();
  }

  private renderKillfeed(): void {
    const el = this.root.querySelector('#killfeed');
    if (!el) return;
    el.innerHTML = this.killfeed.map((k) => {
      const w = this.data.data.weapons.get(k.weapon)?.displayName ?? k.weapon;
      const a = this.nameOf(k.attacker);
      const v = this.nameOf(k.victim);
      const cls = this.teamOf(k.attacker) === 'T' ? 't' : 'ct';
      return `<div class="kf-row ${cls}"><span>${a}</span><span class="w">${w}</span><span class="hs">${k.headshot ? '⌖' : '›'}</span><span>${v}</span></div>`;
    }).join('');
  }

  chat(text: string, cls = ''): void {
    const el = this.root.querySelector('#chat');
    if (!el) return;
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    el.appendChild(div);
    while (el.children.length > 7) el.removeChild(el.firstChild!);
  }

  hitmarker(headshot: boolean, kill: boolean): void {
    this.hitEl.classList.remove('show', 'head');
    void this.hitEl.offsetWidth;
    this.hitEl.classList.add('show');
    if (headshot) this.hitEl.classList.add('head');
    if (kill) this.hitEl.style.filter = 'brightness(1.5)';
    else this.hitEl.style.filter = '';
    window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.hitEl.classList.remove('show'), 220);
  }

  damage(amount: number): void {
    const el = this.root.querySelector('#hud-damage') as HTMLElement;
    if (!el) return;
    el.style.opacity = String(Math.min(0.85, 0.25 + amount / 100));
    window.clearTimeout(this.pingTimer);
    this.pingTimer = window.setTimeout(() => { el.style.opacity = '0'; }, 220);
  }

  showBanner(title: string, sub: string, ms = 2200): void {
    const b = this.root.querySelector('#banner') as HTMLElement;
    (this.root.querySelector('#banner-title') as HTMLElement).textContent = title;
    (this.root.querySelector('#banner-sub') as HTMLElement).textContent = sub;
    b.classList.add('on');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('on'), ms);
  }

  setBuyOpen(open: boolean): void {
    this.buyOpen = open;
    this.root.querySelector('#buy-menu')?.classList.toggle('open', open);
    if (open) this.renderBuy();
  }

  get isBuyOpen(): boolean { return this.buyOpen; }

  renderBuy(): void {
    const body = this.root.querySelector('#buy-body');
    if (!body) return;
    const byCat = new Map<string, typeof this.buyItems>();
    for (const item of this.buyItems) {
      const arr = byCat.get(item.cat) ?? [];
      arr.push(item);
      byCat.set(item.cat, arr);
    }
    body.innerHTML = Array.from(byCat.entries()).map(([cat, items]) => `
      <div class="buy-col"><h3>${CAT_LABELS[cat] ?? cat.toUpperCase()}</h3>
        ${items.map((it) => `<button class="buy-item" data-buy="${it.id}"><b>${it.name}</b><span>◆ ${it.price}</span></button>`).join('')}
      </div>`).join('');
    body.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.cb.onBuy(b.dataset.buy!);
    }));
  }

  setBuyMessage(text: string, bad = false): void {
    const el = this.root.querySelector('#buy-msg') as HTMLElement;
    if (!el) return;
    el.textContent = text;
    el.style.color = bad ? 'var(--danger)' : 'var(--accent-2)';
  }

  setBuyMoney(money: number): void {
    const el = this.root.querySelector('#buy-cash');
    if (el) el.textContent = `◆ ${money}`;
    const cash = this.root.querySelector('#buy-cash') as HTMLElement | null;
    if (cash && this.buyOpen) {
      this.root.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
        const item = this.buyItems.find((i) => i.id === b.dataset.buy);
        if (item) b.disabled = item.price > money;
      });
    }
  }

  toggleScoreboard(open: boolean): void {
    this.scoreboardOpen = open;
    this.root.querySelector('#scoreboard')?.classList.toggle('open', open);
    if (open) this.renderScoreboard();
  }

  private renderScoreboard(): void {
    const teams: ('T' | 'CT')[] = ['T', 'CT'];
    const container = this.root.querySelector('#sb-teams');
    if (!container) return;
    container.innerHTML = teams.map((team) => {
      const rows = this.roster.filter((r) => r.team === team).sort((a, b) => (this.scores.get(b.id)?.kills ?? 0) - (this.scores.get(a.id)?.kills ?? 0));
      return `<div class="sb-team ${team === 'T' ? 't' : 'ct'}"><h4>${team} · ${rows.length} NGƯỜI</h4>
        <div class="sb-row head"><span>NGƯỜI CHƠI</span><span>TT</span><span>K</span><span>D</span><span>HP</span><span>TRẠNG THÁI</span></div>
        ${rows.map((r) => {
          const s = this.scores.get(r.id) ?? { kills: 0, deaths: 0 };
          return `<div class="sb-row ${r.id === 0 ? 'you' : ''}"><span>${r.name}${r.bot ? '<span class="bot-tag">BOT</span>' : ''}</span><span>${r.role.toUpperCase()}</span><span>${s.kills}</span><span>${s.deaths}</span><span>—</span><span>${r.id === 0 ? 'BẠN' : 'BOT'}</span></div>`;
        }).join('')}
      </div>`;
    }).join('');
    const sub = this.root.querySelector('#sb-sub');
    if (sub) sub.textContent = `${this.map.json.name.toUpperCase()} · ${this.roster.length} NGƯỜI`;
  }

  update(snap: NetSnapshot): void {
    const r = snap.round;
    const self = snap.self;
    (this.root.querySelector('#score-t') as HTMLElement).textContent = String(r.scoreT);
    (this.root.querySelector('#score-ct') as HTMLElement).textContent = String(r.scoreCT);
    (this.root.querySelector('#round-tag') as HTMLElement).textContent = r.overtime ? `OVERTIME ${r.roundNumber}` : `ROUND ${r.roundNumber} · BEST OF 24`;
    const phase = r.phase;
    const left = Math.max(0, (r.phaseEndTick - snap.tick) / 64);
    const bombLeft = r.bombPlanted ? Math.max(0, (r.bombTimerEndTick - snap.tick) / 64) : 0;
    const clock = this.root.querySelector('#match-clock') as HTMLElement;
    const timeEl = this.root.querySelector('#clock-time') as HTMLElement;
    const labelEl = this.root.querySelector('#clock-label') as HTMLElement;
    if (r.bombPlanted) {
      clock.classList.add('bomb');
      timeEl.textContent = fmtTime(bombLeft);
      labelEl.textContent = 'BOMB ACTIVE';
    } else {
      clock.classList.remove('bomb');
      timeEl.textContent = r.phase === 'over' ? '—' : fmtTime(left);
      labelEl.textContent = phase === 'freeze' ? 'MUA SẮM' : phase === 'warmup' ? 'WARMUP' : phase === 'matchEnd' ? 'KẾT THÚC' : `ROUND ${r.roundNumber}`;
    }
    (this.root.querySelector('#hp-num') as HTMLElement).textContent = String(self.health);
    (this.root.querySelector('#armor-num') as HTMLElement).textContent = String(self.armor);
    (this.root.querySelector('#hp-bar') as HTMLElement).style.width = `${Math.max(0, self.health)}%`;
    (this.root.querySelector('#armor-bar') as HTMLElement).style.width = `${Math.max(0, Math.min(100, self.armor))}%`;
    (this.root.querySelector('#vital-hp') as HTMLElement).classList.toggle('low', self.health <= 35);
    (this.root.querySelector('#money') as HTMLElement).textContent = String(self.money);
    this.setBuyMoney(self.money);
    const wid = this.data.data.weaponsList[snap.self.weaponIdx]?.id ?? 'knife';
    const w = this.data.data.weapons.get(wid);
    (this.root.querySelector('#ammo-weapon') as HTMLElement).textContent = w?.displayName ?? 'KNIFE';
    if (w && w.slot !== 'knife') {
      (this.root.querySelector('#ammo') as HTMLElement).style.display = '';
      (this.root.querySelector('#ammo-mag') as HTMLElement).textContent = String(self.ammo);
      (this.root.querySelector('#ammo-reserve') as HTMLElement).textContent = ` / ${self.reserve}`;
      (this.root.querySelector('#ammo') as HTMLElement).classList.toggle('low', self.ammo <= Math.max(1, Math.floor(w.magazine * 0.2)));
    } else {
      (this.root.querySelector('#ammo') as HTMLElement).style.display = 'none';
    }
    const names = ['HE', 'FLASH', 'SMOKE', 'FIRE', 'FIRE'];
    (this.root.querySelector('#nades') as HTMLElement).innerHTML = self.grenades.map((n, i) => `<span class="nade ${n === 0 ? 'zero' : ''}">${names[i]} ${n}</span>`).join('');
    (this.root.querySelector('#loadout-mini') as HTMLElement).textContent = [self.primaryIdx !== 255 ? 'PRIMARY' : '', self.secondaryIdx !== 255 ? 'PISTOL' : '', self.helmet ? 'HELMET' : '', self.hasKit ? 'KIT' : ''].filter(Boolean).join(' · ');
    const obj = this.root.querySelector('#objective') as HTMLElement;
    const hint = this.root.querySelector('#bomb-hint') as HTMLElement;
    if (self.planting) {
      obj.style.display = 'flex';
      (this.root.querySelector('#objective-text') as HTMLElement).textContent = 'ĐẶT BOM';
      (this.root.querySelector('#objective-fill') as HTMLElement).style.width = `${Math.round(self.plantProgress * 100)}%`;
    } else if (self.defusing) {
      obj.style.display = 'flex';
      (this.root.querySelector('#objective-text') as HTMLElement).textContent = 'GỠ BOM';
      (this.root.querySelector('#objective-fill') as HTMLElement).style.width = `${Math.round(self.defuseProgress * 100)}%`;
    } else {
      obj.style.display = 'none';
    }
    const atSite = this.map.siteAt(self.x, self.z);
    const canPlant = self.alive && self.hasBomb && atSite !== null && phase === 'live';
    const canDefuse = self.alive && r.bombPlanted && Math.hypot(self.x - r.bombX, self.z - r.bombZ) < 2 && phase === 'live';
    hint.classList.toggle('on', canPlant || canDefuse);
    hint.textContent = canPlant ? 'GIỮ E ĐỂ ĐẶT BOM' : canDefuse ? 'GIỮ E ĐỂ GỠ BOM' : '';
    (this.root.querySelector('#spectate') as HTMLElement).classList.toggle('on', !self.alive && phase !== 'matchEnd');
    (this.root.querySelector('#spectate-target') as HTMLElement).textContent = self.respawnAtTick > snap.tick ? `HỒI SINH SAU ${Math.ceil((self.respawnAtTick - snap.tick) / 64)}S` : 'CHỜ VÒNG MỚI';
    (this.root.querySelector('#hud-flash') as HTMLElement).style.opacity = String(Math.min(1, self.flashIntensity));
    this.isScoped = self.scoped;
    (this.root.querySelector('#scope') as HTMLElement).classList.toggle('on', self.scoped);
    (this.root.querySelector('#crosshair') as HTMLElement).style.display = self.scoped ? 'none' : 'block';
    const ch = this.root.querySelector('#crosshair') as HTMLElement;
    const speed = Math.hypot(self.vx, self.vz);
    const spread = (w?.spread.stand ?? 2) * 0.55 + speed * 0.75 + (self.grounded ? 0 : 9) + (self.recoilShots * 0.4);
    ch.style.setProperty('--gap', `${this.settings.hud.crosshair.gap * 0.7 + spread + (self.crouching ? -1 : 0)}px`);
    if (r.phase !== this.lastPhase) {
      if (r.phase === 'freeze') this.showBanner(`ROUND ${r.roundNumber}`, 'MUA SẮM — GIỮ B', 1800);
      if (r.phase === 'live') this.showBanner('LIVE', r.bombPlanted ? 'BOMB ĐÃ ĐẶT' : 'TIÊU DIỆT ĐỐI PHƯƠNG HOẶC ĐẶT BOM', 1400);
      if (r.phase === 'over') this.showBanner(r.winner === 0 ? 'T THẮNG' : 'CT THẮNG', 'KẾT THÚC VÒNG', 2200);
      this.lastPhase = r.phase;
    }
    if (r.roundNumber !== this.lastRound) { this.lastRound = r.roundNumber; this.spotted.clear(); }
    this.drawRadar(snap);
    if (this.scoreboardOpen) this.renderScoreboard();
  }

  markSpotted(id: number): void { this.spotted.set(id, performance.now() + 1800); }

  private drawRadar(snap: NetSnapshot): void {
    const ctx = this.radarCtx;
    const canvas = ctx?.canvas;
    if (!ctx || !canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth || 176, chh = canvas.clientHeight || 176;
    if (canvas.width !== Math.floor(cw * dpr) || canvas.height !== Math.floor(chh * dpr)) {
      canvas.width = Math.floor(cw * dpr); canvas.height = Math.floor(chh * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, chh);
    const bounds = this.map.json.bounds;
    const wx = bounds[3] - bounds[0], wz = bounds[5] - bounds[2];
    const scale = Math.min((cw - 8) / wx, (chh - 8) / wz);
    const ox = (cw - wx * scale) / 2, oy = (chh - wz * scale) / 2;
    const toX = (x: number): number => ox + (x - bounds[0]) * scale;
    const toY = (z: number): number => oy + (z - bounds[2]) * scale;
    ctx.fillStyle = 'rgba(12,18,23,.9)'; ctx.fillRect(0, 0, cw, chh);
    for (let r = 0; r < this.map.height; r++) {
      for (let c = 0; c < this.map.width; c++) {
        const cell = this.map.cellAt(c, r);
        if (cell === '#') ctx.fillStyle = 'rgba(60,76,88,.55)';
        else if (cell === 'x' || cell === 'X') ctx.fillStyle = 'rgba(120,98,62,.5)';
        else continue;
        const [x, z] = this.map.cellCenter(c, r);
        ctx.fillRect(toX(x - this.map.cellSize / 2), toY(z - this.map.cellSize / 2), this.map.cellSize * scale, this.map.cellSize * scale);
      }
    }
    for (const site of this.map.json.sites) {
      ctx.fillStyle = 'rgba(224,180,66,.14)';
      ctx.fillRect(toX(site.rect[0]), toY(site.rect[1]), (site.rect[2] - site.rect[0]) * scale, (site.rect[3] - site.rect[1]) * scale);
      ctx.fillStyle = 'rgba(224,180,66,.8)'; ctx.font = 'bold 9px monospace';
      ctx.fillText(site.id, toX(site.center[0]) - 3, toY(site.center[2]) + 3);
    }
    const now = performance.now();
    const selfTeam = snap.players.find((q) => q.id === snap.self.id)?.team ?? 'T';
    for (const p of snap.players) {
      const isSelf = p.id === snap.self.id;
      if (!isSelf && p.team !== selfTeam) {
        const until = this.spotted.get(p.id) ?? 0;
        if (until < now || !p.alive) continue;
        ctx.fillStyle = '#e0504a';
        ctx.beginPath(); ctx.arc(toX(p.x), toY(p.z), 2.6, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      if (!p.alive) continue;
      ctx.fillStyle = p.team === 'T' ? '#d6a23a' : '#6fa8d6';
      ctx.beginPath(); ctx.arc(toX(p.x), toY(p.z), isSelf ? 3.2 : 2.4, 0, Math.PI * 2); ctx.fill();
      if (isSelf) {
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(toX(p.x), toY(p.z));
        ctx.lineTo(toX(p.x) + Math.sin(snap.self.yaw) * 10, toY(p.z) + Math.cos(snap.self.yaw) * 10);
        ctx.stroke();
      }
    }
    if (snap.round.bombPlanted) {
      ctx.fillStyle = '#ff4a3a';
      ctx.fillRect(toX(snap.round.bombX) - 3, toY(snap.round.bombZ) - 3, 6, 6);
    }
  }

  toggleDebug(on: boolean, text: string): void {
    const el = this.root.querySelector('#debug') as HTMLElement;
    el.classList.toggle('on', on);
    el.textContent = text;
  }

  showChatInput(placeholder: string): HTMLInputElement | null {
    const wrap = this.root.querySelector('#text-entry') as HTMLElement;
    const input = this.root.querySelector('#chat-input') as HTMLInputElement;
    wrap.classList.add('on');
    input.placeholder = placeholder;
    input.value = '';
    input.focus();
    return input;
  }

  hideChatInput(): void {
    (this.root.querySelector('#text-entry') as HTMLElement).classList.remove('on');
    (this.root.querySelector('#chat-input') as HTMLInputElement).blur();
  }

  resetMatch(): void {
    this.killfeed = [];
    this.spotted.clear();
    this.lastPhase = '';
    this.lastRound = -1;
    this.scores.clear();
    for (const r of this.roster) this.scores.set(r.id, { kills: 0, deaths: 0 });
    this.renderKillfeed();
  }

  get scoped(): boolean { return this.isScoped; }

  addEnemyPing(player: NetPlayer): void {
    if (player.team === this.roster.find((r) => r.id === 0)?.team) return;
    this.spotted.set(player.id, performance.now() + 1800);
  }

  dispose(): void { this.root.remove(); }
}
