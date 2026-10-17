import type { DataBundle } from '../data';
import type { OfflineOptions, GameMode } from '../sim/protocol';
import type { ProfileStore, SettingsStore, ClientSettings } from '../game/store';
import type { SkinDef, SkinInstance } from '../render/skins';
import type { GameMap, Team } from '@tactical/shared';
import { resolveOnlineUrl } from '../sim/online';
import type { ReplayStore, SavedReplay } from '../game/replay-store';

export interface MenuCallbacks {
  onStart: (options: OfflineOptions) => void;
  onSettingsChanged: () => void;
  onEquip: (weaponId: string, inst: SkinInstance | null) => void;
  onResume: () => void;
  onQuit: () => void;
  onRestart: () => void;
  onStartOnline: (options: OfflineOptions) => void;
  onWatchReplay: (json: string) => void;
}

type OnlineState = { mode: 'competitive' | 'quick' | 'deathmatch'; mapId: string; team: Team; botsPerSide: number; tier: string; roomCode: string };

const TIERS = [
  { id: 'rookie', label: 'Rookie' },
  { id: 'regular', label: 'Regular' },
  { id: 'veteran', label: 'Veteran' },
  { id: 'elite', label: 'Elite' },
  { id: 'pro', label: 'Pro' },
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function fmt(n: number): string { return n.toLocaleString('vi-VN'); }

function drawMapPreview(canvas: HTMLCanvasElement, map: GameMap): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = canvas.clientWidth || 260, ch = canvas.clientHeight || 108;
  canvas.width = Math.floor(cw * dpr); canvas.height = Math.floor(ch * dpr);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0a0f13'; ctx.fillRect(0, 0, cw, ch);
  const pad = 6;
  const scale = Math.min((cw - pad * 2) / map.width, (ch - pad * 2) / map.height);
  const ox = (cw - map.width * scale) / 2, oy = (ch - map.height * scale) / 2;
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const cell = map.cellAt(c, r);
      if (cell === '#') ctx.fillStyle = '#39454f';
      else if (cell === 'x' || cell === 'X') ctx.fillStyle = '#5d503b';
      else if (cell === 'h') ctx.fillStyle = '#4a5158';
      else if (cell === 'A' || cell === 'B') ctx.fillStyle = '#7a6428';
      else if (cell === 'T') ctx.fillStyle = '#6a5322';
      else if (cell === 'C') ctx.fillStyle = '#2f4d68';
      else ctx.fillStyle = '#11181e';
      ctx.fillRect(ox + c * scale, oy + r * scale, Math.ceil(scale), Math.ceil(scale));
    }
  }
  for (const site of map.json.sites) {
    const [x1, z1, x2, z2] = site.rect;
    const px = (x: number): number => ox + ((x - map.originX) / map.cellSize) * scale;
    const pz = (z: number): number => oy + ((z - map.originZ) / map.cellSize) * scale;
    ctx.strokeStyle = 'rgba(224,180,66,.65)'; ctx.lineWidth = 1;
    ctx.strokeRect(px(x1), pz(z1), px(x2) - px(x1), pz(z2) - pz(z1));
    ctx.fillStyle = 'rgba(224,180,66,.9)'; ctx.font = 'bold 9px monospace';
    ctx.fillText(site.id, px(site.center[0]) - 3, pz(site.center[2]) + 3);
  }
}

export class Menus {
  private readonly screenHost: HTMLDivElement;
  private setupState: { mode: GameMode; mapId: string; team: Team; botsPerSide: number; tier: string; name: string };
  private readonly elements: Record<string, HTMLElement> = {};
  private onlineState: OnlineState = { mode: 'competitive', mapId: 'sandstorm', team: 'T', botsPerSide: 2, tier: 'regular', roomCode: '' };
  private toastTimer = 0;
  gameActive = false;

  constructor(
    root: HTMLElement,
    private readonly bundle: DataBundle,
    private readonly settings: SettingsStore,
    private readonly profile: ProfileStore,
    private readonly replayStore: ReplayStore,
    private readonly cb: MenuCallbacks,
  ) {
    this.screenHost = document.createElement('div');
    this.screenHost.className = 'menu-host';
    root.appendChild(this.screenHost);
    this.setupState = {
      mode: 'competitive', mapId: 'sandstorm', team: 'T', botsPerSide: 5,
      tier: 'regular', name: this.profile.value.name,
    };
    this.buildMain();
    this.buildSetup();
    this.buildOnline();
    this.buildReplays();
    this.buildArmory();
    this.buildSettings();
    this.buildAbout();
    this.buildPause();
    this.buildResults();
    this.buildToast();
    this.show('main');
  }

  private addScreen(id: string, html: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'screen';
    el.id = `screen-${id}`;
    el.innerHTML = html;
    this.screenHost.appendChild(el);
    this.elements[id] = el;
    return el;
  }

  private buildMain(): void {
    const el = this.addScreen('main', `
      <div class="menu-shell">
        <div class="topline">
          <div class="brand">
            <div class="brand-mark">TS</div>
            <div class="brand-text"><b>TACTICAL STRIKE</b><span>ORIGINAL TACTICAL FPS · BUILD 0.1</span></div>
          </div>
          <div class="profile">
            <span id="profile-name">OPERATOR</span>
            <span class="credits" id="profile-credits">2.500 Credits</span>
          </div>
        </div>
        <div class="menu-main">
          <div class="menu-nav">
            <div class="menu-kicker">// 5V5 BOMB DEFUSAL · TRÌNH DUYỆT</div>
            <h1 class="menu-title">TACTICAL<br><em>STRIKE</em></h1>
            <button class="menu-btn primary" data-act="play"><span class="idx">01</span>Chơi với bot<small>OFFLINE</small></button>
            <button class="menu-btn" data-act="online"><span class="idx">02</span>Chơi online<small>SERVER BETA</small></button>
            <button class="menu-btn" data-act="replays"><span class="idx">03</span>Xem lại trận<small>REPLAY</small></button>
            <button class="menu-btn" data-act="armory"><span class="idx">04</span>Kho vũ khí<small>SKINS</small></button>
            <button class="menu-btn" data-act="settings"><span class="idx">05</span>Cài đặt<small>SYSTEM</small></button>
            <button class="menu-btn" data-act="about"><span class="idx">06</span>Giới thiệu<small>INFO</small></button>
          </div>
          <div class="menu-side">
            <div class="brief-card">
              <h4>// NHIỆM VỤ</h4>
              <p>5v5 luật MR12. Đặt hoặc gỡ bom. Kinh tế quyết định vòng đấu. Mọi nội dung là thiết kế gốc, không sử dụng tài sản hay tên gọi của bất kỳ tựa game nào khác.</p>
            </div>
            <div class="brief-stats">
              <div><b>64 Hz</b><span>SIMULATION</span></div>
              <div><b>32 Hz</b><span>SNAPSHOT</span></div>
              <div><b id="stat-matches">0</b><span>MATCHES</span></div>
              <div><b id="stat-wins">0</b><span>WINS</span></div>
            </div>
            <div class="brief-card">
              <h4>// TRẠNG THÁI</h4>
              <p id="main-status" class="loading-inline">Đang kiểm tra renderer…</p>
            </div>
          </div>
        </div>
        <div class="menu-foot">
          <div><span class="dot"></span><span id="backend-status">RENDERER: ĐANG KHỞI TẠO</span></div>
          <div>TACTICAL STRIKE © 2026 · ORIGINAL IP · VER 0.1.0</div>
        </div>
      </div>`);
    el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        switch (b.dataset.act) {
          case 'play': this.show('setup'); break;
          case 'online': this.show('online'); break;
          case 'replays': this.renderReplays(); this.show('replays'); break;
          case 'armory': this.buildArmoryGrid(); this.show('armory'); break;
          case 'settings': this.fillSettings(); this.show('settings'); break;
          case 'about': this.show('about'); break;
          default: break;
        }
      });
      });
    this.refreshProfile();
  }

  private buildSetup(): void {
    const maps = Object.values(this.bundle.maps).filter((m) => ['sandstorm', 'warehouse', 'range'].includes(m.json.id));
    const el = this.addScreen('setup', `
      <div class="setup">
        <div class="setup-head">
          <div>
            <h1>Chuẩn bị trận đấu</h1>
            <p>Chọn chế độ, bản đồ và độ khó. Bot luôn được gắn nhãn BOT.</p>
          </div>
          <button class="btn ghost" data-act="back">← Quay lại</button>
        </div>
        <div class="setup-grid">
          <div class="setup-left">
            <div class="field">
              <div class="field-label"><span>Chế độ</span><span id="mode-desc">MR12 · đổi phe giữa hiệp</span></div>
              <div class="seg" id="mode-seg">
                <button data-mode="competitive" class="on">Competitive MR12</button>
                <button data-mode="quick">Quick Play MR6</button>
                <button data-mode="deathmatch">Deathmatch</button>
                <button data-mode="range">Range</button>
              </div>
            </div>
            <div class="field">
              <div class="field-label"><span>Bản đồ</span><span>3 bản đồ gốc</span></div>
              <div class="maps" id="map-list">
                ${maps.map((m) => `
                  <button class="map-card ${m.json.id === this.setupState.mapId ? 'on' : ''}" data-map="${m.json.id}">
                    <canvas data-map-preview="${m.json.id}"></canvas>
                    <div class="meta"><b>${esc(m.json.name)}</b><span>${m.json.sites.length ? `${m.json.sites.length} SITES` : 'TRAINING'}</span></div>
                  </button>`).join('')}
              </div>
            </div>
            <div class="field">
              <div class="field-label"><span>Phe của bạn</span><span id="team-hint">T · tấn công</span></div>
              <div class="seg" id="team-seg">
                <button data-team="T" class="on">T · Attacker</button>
                <button data-team="CT">CT · Defender</button>
                <button data-team="auto">Ngẫu nhiên</button>
              </div>
            </div>
            <div class="field">
              <div class="field-label"><span>Quy mô đội</span><span id="size-label">5v5</span></div>
              <div class="seg" id="size-seg">
                ${[1, 2, 3, 4, 5].map((n) => `<button data-size="${n}" class="${n === 5 ? 'on' : ''}">${n}v${n}</button>`).join('')}
              </div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:18px;min-height:0">
            <div class="field">
              <div class="field-label"><span>Độ khó bot</span><span id="tier-label">Regular</span></div>
              <div class="seg" id="tier-seg">
                ${TIERS.map((t) => `<button data-tier="${t.id}" class="${t.id === this.setupState.tier ? 'on' : ''}">${t.label}</button>`).join('')}
              </div>
            </div>
            <div class="field">
              <div class="field-label"><span>Tên hiển thị</span><span>LOCAL</span></div>
              <input id="name-input" class="interactive" style="background:#0b1116;border:1px solid var(--line);color:var(--text);padding:10px 12px;font-family:var(--font-mono);font-size:11px;letter-spacing:.08em" maxlength="20" value="${esc(this.setupState.name)}" />
            </div>
            <div class="panel roster" id="roster-preview"></div>
            <div class="setup-summary" id="setup-summary"></div>
          </div>
        </div>
        <div class="setup-actions">
          <div class="setup-summary">Bản thử nghiệm offline — listen-server chạy trong Web Worker, dùng chung mô phỏng với chế độ online.</div>
          <button class="btn gold" id="start-offline" style="min-width:240px">Bắt đầu trận →</button>
        </div>
      </div>`);
    el.querySelector('[data-act="back"]')?.addEventListener('click', () => this.show('main'));
    el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      this.setupState.mode = b.dataset.mode as GameMode;
      if (this.setupState.mode === 'range') this.setupState.mapId = 'range';
      else if (this.setupState.mapId === 'range') this.setupState.mapId = 'sandstorm';
      el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
      (el.querySelector('#mode-desc') as HTMLElement).textContent = this.setupState.mode === 'competitive' ? 'MR12 · đổi phe giữa hiệp' : this.setupState.mode === 'quick' ? 'MR6 · nhanh' : this.setupState.mode === 'deathmatch' ? 'Hồi sinh liên tục' : 'Trường bắn, tiền vô hạn';
      this.refreshSetup();
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) => b.addEventListener('click', () => {
      this.setupState.mapId = b.dataset.map!;
      el.querySelectorAll('[data-map]').forEach((x) => x.classList.toggle('on', x === b));
      if (this.setupState.mapId === 'range') this.setupState.mode = 'range';
      el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', (x as HTMLButtonElement).dataset.mode === this.setupState.mode));
      this.refreshSetup();
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-team]').forEach((b) => b.addEventListener('click', () => {
      this.setupState.team = b.dataset.team === 'auto' ? (Math.random() < 0.5 ? 'T' : 'CT') : b.dataset.team as Team;
      el.querySelectorAll('[data-team]').forEach((x) => x.classList.toggle('on', x === b));
      this.refreshSetup();
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) => b.addEventListener('click', () => {
      this.setupState.botsPerSide = Number(b.dataset.size);
      el.querySelectorAll('[data-size]').forEach((x) => x.classList.toggle('on', x === b));
      this.refreshSetup();
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((b) => b.addEventListener('click', () => {
      this.setupState.tier = b.dataset.tier!;
      el.querySelectorAll('[data-tier]').forEach((x) => x.classList.toggle('on', x === b));
      this.refreshSetup();
    }));
    el.querySelector<HTMLInputElement>('#name-input')?.addEventListener('input', (e) => {
      this.setupState.name = (e.target as HTMLInputElement).value.replace(/[<>]/g, '').slice(0, 20);
    });
    el.querySelector('#start-offline')?.addEventListener('click', () => {
      if (!this.setupState.name.trim()) this.toast('Hãy nhập tên hiển thị', true);
      const opts: OfflineOptions = {
        name: this.setupState.name.trim() || 'Operator',
        mode: this.setupState.mode,
        mapId: this.setupState.mapId,
        team: this.setupState.team,
        botsPerSide: this.setupState.botsPerSide,
        tier: this.setupState.tier,
        seed: (Math.random() * 1e9) | 0,
      };
      this.profile.value.name = opts.name;
      this.profile.save();
      this.cb.onStart(opts);
    });
    for (const canvas of Array.from(el.querySelectorAll<HTMLCanvasElement>('[data-map-preview]'))) {
      const map = this.bundle.maps[canvas.dataset.mapPreview!];
      if (map) drawMapPreview(canvas, map);
    }
    this.refreshSetup();
  }

  private buildOnline(): void {
    const maps = Object.values(this.bundle.maps).filter((m) => ['sandstorm', 'warehouse', 'range'].includes(m.json.id));
    const el = this.addScreen('online', `
      <div class="subpage">
        <div class="subpage-head">
          <div><h1>Chơi online</h1><p style="margin:4px 0 0;color:var(--muted);font-size:12px">Kết nối máy chủ có thẩm quyền · bot do máy chủ điều khiển · luôn gắn nhãn BOT</p></div>
          <button class="btn ghost" data-act="back">← Quay lại</button>
        </div>
        <div class="subpage-body">
          <div class="setup-grid">
            <div class="setup-left">
              <div class="field">
                <div class="field-label"><span>Địa chỉ máy chủ</span><span>WEBSOCKET</span></div>
                <input id="online-url" class="interactive" spellcheck="false" style="background:#0b1116;border:1px solid var(--line);color:var(--text);padding:10px 12px;font-family:var(--font-mono);font-size:11px" value="${esc(resolveOnlineUrl())}" placeholder="wss://may-chu-cua-ban/ws" />
              </div>
              <div class="field">
                <div class="field-label"><span>Chế độ</span><span id="online-mode-desc">MR12 · server quản lý vòng đấu</span></div>
                <div class="seg" id="omode-seg">
                  <button data-omode="competitive" class="on">Competitive MR12</button>
                  <button data-omode="quick">Quick Play MR6</button>
                  <button data-omode="deathmatch">Deathmatch</button>
                </div>
              </div>
              <div class="field">
                <div class="field-label"><span>Bản đồ</span><span>server chọn</span></div>
                <div class="seg" id="omap-seg">
                  ${maps.map((m) => `<button data-omap="${m.json.id}" class="${m.json.id === this.onlineState.mapId ? 'on' : ''}">${esc(m.json.name)}</button>`).join('')}
                </div>
              </div>
              <div class="field">
                <div class="field-label"><span>Phe của bạn</span><span>TEAM</span></div>
                <div class="seg" id="oteam-seg">
                  <button data-oteam="T" class="on">T · Attacker</button>
                  <button data-oteam="CT">CT · Defender</button>
                </div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:18px;min-height:0">
              <div class="field">
                <div class="field-label"><span>Bot bù vào đội</span><span id="obots-label">2 mỗi bên</span></div>
                <div class="seg" id="obots-seg">
                  ${[0, 1, 2, 3, 4, 5].map((n) => `<button data-obots="${n}" class="${n === 2 ? 'on' : ''}">${n}</button>`).join('')}
                </div>
              </div>
              <div class="field">
                <div class="field-label"><span>Độ khó bot</span><span id="otier-label">Regular</span></div>
                <div class="seg" id="otier-seg">
                  ${TIERS.map((t) => `<button data-otier="${t.id}" class="${t.id === 'regular' ? 'on' : ''}">${t.label}</button>`).join('')}
                </div>
              </div>
              <div class="field">
                <div class="field-label"><span>Mã phòng (tùy chọn)</span><span>PRIVATE</span></div>
                <input id="online-room" class="interactive" spellcheck="false" maxlength="8" placeholder="để trống = phòng mới" style="background:#0b1116;border:1px solid var(--line);color:var(--text);padding:10px 12px;font-family:var(--font-mono);font-size:11px" />
              </div>
              <div class="panel" style="padding:16px;font-size:12px;line-height:1.6;color:var(--muted)">
                <b style="color:var(--text)">// CẦN MÁY CHỦ</b>
                <p style="margin:8px 0 0">Chạy <code>pnpm dev:server</code> (cổng 8443) và <code>pnpm dev:api</code> (8080) trước. Nếu mở client qua Vite, proxy <code>/ws</code> đã được cấu hình. Không kết nối được thì thử lại hoặc dùng chế độ offline với bot.</p>
                ${location.hostname.endsWith('github.io') ? '<p style="margin:8px 0 0;color:var(--accent)">Bản GitHub Pages là tĩnh: chỉ chơi offline. Muốn online, nhập <code>wss://…/ws</code> của một máy chủ Node đang chạy.</p>' : ''}
              </div>
              <button class="btn gold" id="start-online">Kết nối &amp; vào trận →</button>
            </div>
          </div>
        </div>
      </div>`);
    el.querySelector('[data-act="back"]')?.addEventListener('click', () => this.show('main'));
    el.querySelectorAll<HTMLButtonElement>('[data-omode]').forEach((b) => b.addEventListener('click', () => {
      this.onlineState.mode = b.dataset.omode as OnlineState['mode'];
      el.querySelectorAll('[data-omode]').forEach((x) => x.classList.toggle('on', x === b));
      const desc = el.querySelector('#online-mode-desc');
      if (desc) desc.textContent = this.onlineState.mode === 'competitive' ? 'MR12 · server quản lý vòng đấu' : this.onlineState.mode === 'quick' ? 'MR6 · trận ngắn' : 'Deathmatch · hồi sinh liên tục';
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-omap]').forEach((b) => b.addEventListener('click', () => {
      this.onlineState.mapId = b.dataset.omap!;
      el.querySelectorAll('[data-omap]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-oteam]').forEach((b) => b.addEventListener('click', () => {
      this.onlineState.team = b.dataset.oteam as Team;
      el.querySelectorAll('[data-oteam]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-obots]').forEach((b) => b.addEventListener('click', () => {
      this.onlineState.botsPerSide = Number(b.dataset.obots);
      el.querySelectorAll('[data-obots]').forEach((x) => x.classList.toggle('on', x === b));
      const label = el.querySelector('#obots-label');
      if (label) label.textContent = this.onlineState.botsPerSide === 0 ? 'chỉ người thật' : `${this.onlineState.botsPerSide} mỗi bên`;
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-otier]').forEach((b) => b.addEventListener('click', () => {
      this.onlineState.tier = b.dataset.otier!;
      el.querySelectorAll('[data-otier]').forEach((x) => x.classList.toggle('on', x === b));
      const label = el.querySelector('#otier-label');
      if (label) label.textContent = TIERS.find((t) => t.id === this.onlineState.tier)?.label ?? 'Regular';
    }));
    el.querySelector<HTMLButtonElement>('#start-online')?.addEventListener('click', () => {
      const urlInput = el.querySelector<HTMLInputElement>('#online-url');
      const roomInput = el.querySelector<HTMLInputElement>('#online-room');
      const url = (urlInput?.value ?? '').trim();
      if (!/^wss?:\/\//i.test(url)) { this.toast('Địa chỉ máy chủ phải bắt đầu bằng ws:// hoặc wss://', true); return; }
      this.onlineState.roomCode = (roomInput?.value ?? '').trim().toUpperCase();
      this.toast('Đang kết nối máy chủ…');
      this.cb.onStartOnline({
        name: this.setupState.name.trim() || 'Operator',
        mode: this.onlineState.mode,
        mapId: this.onlineState.mapId,
        team: this.onlineState.team,
        botsPerSide: this.onlineState.botsPerSide,
        tier: this.onlineState.tier,
        url,
        roomCode: this.onlineState.roomCode || undefined,
      });
    });
  }

  private buildReplays(): void {
    const el = this.addScreen('replays', `
      <div class="subpage">
        <div class="subpage-head">
          <div><h1>Xem lại trận</h1><p style="margin:4px 0 0;color:var(--muted);font-size:12px">Replay lưu seed + input, phát lại bằng cùng mô phỏng 64 Hz — tất định với bot.</p></div>
          <button class="btn ghost" data-act="back">← Quay lại</button>
        </div>
        <div class="subpage-body"><div id="replay-list" class="panel" style="padding:16px;display:flex;flex-direction:column;gap:10px"></div></div>
      </div>`);
    el.querySelector('[data-act="back"]')?.addEventListener('click', () => this.show('main'));
  }

  private renderReplays(): void {
    const el = this.elements.replays;
    const host = el?.querySelector('#replay-list');
    if (!host) return;
    const items: SavedReplay[] = this.replayStore.list();
    if (items.length === 0) {
      host.innerHTML = `<p style="color:var(--muted);font-size:12px;line-height:1.6">Chưa có replay. Chơi một trận offline; khi trận kết thúc, bản ghi được lưu tự động (tối đa 3 trận gần nhất, mỗi bản ≤ 2 MB).</p>`;
      return;
    }
    host.innerHTML = items.map((r) => {
      const map = this.bundle.maps[r.mapId];
      const label = map?.json.name ?? r.mapId;
      const date = new Date(r.savedAt).toLocaleString('vi-VN');
      const kb = Math.max(1, Math.round(r.bytes / 1024));
      return `<div style="display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);padding:8px 0">
        <div style="flex:1"><b style="font-size:12px">${esc(label)} · ${r.mode.toUpperCase()}</b><div style="color:var(--muted);font-size:11px">${esc(date)} · ${kb} KB</div></div>
        <button class="btn gold" data-watch="${r.id}">Xem</button>
        <button class="btn ghost" data-del="${r.id}">Xóa</button>
      </div>`;
    }).join('');
    host.querySelectorAll<HTMLButtonElement>('[data-watch]').forEach((b) => b.addEventListener('click', () => {
      const item = items.find((x) => x.id === b.dataset.watch);
      if (item) this.cb.onWatchReplay(item.data);
    }));
    host.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', () => {
      this.replayStore.remove(b.dataset.del!);
      this.renderReplays();
    }));
  }

  private refreshSetup(): void {
    const el = this.elements.setup;
    if (!el) return;
    const roster = el.querySelector('#roster-preview');
    if (roster) {
      const team = this.setupState.team;
      const enemy: Team = team === 'T' ? 'CT' : 'T';
      const calls = ['Rook', 'Vane', 'Kestrel', 'Mako', 'Iris'];
      const rows: string[] = [];
      for (let i = 0; i < this.setupState.botsPerSide; i++) {
        const cls = team === 'T' ? 't' : 'ct';
        rows.push(`<div class="roster-row ${cls} ${i === 0 ? 'you' : ''}"><span class="team"></span><span class="name">${i === 0 ? esc(this.setupState.name || 'Operator') : `BOT ${calls[i]}`}</span><span class="tag ${i === 0 ? '' : 'bot'}">${i === 0 ? 'BẠN' : 'BOT'}</span></div>`);
      }
      rows.push('<div style="height:4px"></div>');
      for (let i = 0; i < this.setupState.botsPerSide; i++) {
        rows.push(`<div class="roster-row ${enemy === 'T' ? 't' : 'ct'}"><span class="team"></span><span class="name">BOT ${calls[(i + 2) % calls.length]}</span><span class="tag bot">BOT</span></div>`);
      }
      roster.innerHTML = `<h3>// ĐỘI HÌNH ${this.setupState.team} VS ${enemy}</h3>${rows.join('')}`;
    }
    const map = this.bundle.maps[this.setupState.mapId]!;
    const size = el.querySelector('#size-label');
    if (size) size.textContent = `${this.setupState.botsPerSide}v${this.setupState.botsPerSide}`;
    const tier = el.querySelector('#tier-label');
    if (tier) tier.textContent = TIERS.find((t) => t.id === this.setupState.tier)?.label ?? 'Regular';
    const summary = el.querySelector('#setup-summary');
    if (summary) summary.innerHTML = `MAP <b style="color:var(--accent-2)">${esc(map.json.name)}</b> · ${this.setupState.mode.toUpperCase()} · ${this.setupState.botsPerSide}v${this.setupState.botsPerSide} · BOT ${this.setupState.tier.toUpperCase()}<br/>${esc(map.json.description ?? '')}`;
  }

  private buildArmory(): void {
    const el = this.addScreen('armory', `
      <div class="subpage">
        <div class="subpage-head">
          <div><h1>Kho vũ khí</h1><p style="margin:4px 0 0;color:var(--muted);font-size:12px">Skin gốc · cấu hình bằng seed và độ mòn · chỉ dùng Credits</p></div>
          <div style="display:flex;gap:10px;align-items:center"><span class="credits" id="armory-credits">2.500 Credits</span><button class="btn ghost" data-act="back">← Quay lại</button></div>
        </div>
        <div class="subpage-body"><div class="armory-grid" id="armory-grid"></div></div>
      </div>`);
    el.querySelector('[data-act="back"]')?.addEventListener('click', () => this.show('main'));
    this.buildArmoryGrid();
  }

  private buildArmoryGrid(): void {
    const el = this.elements.armory;
    if (!el) return;
    const grid = el.querySelector('#armory-grid');
    if (!grid) return;
    const skins = this.bundle.skins.skins as SkinDef[];
    const creditsEl = el.querySelector('#armory-credits');
    if (creditsEl) creditsEl.textContent = `${fmt(this.profile.value.credits)} Credits`;
    grid.innerHTML = skins.filter((s) => s.status === 'active').map((s) => {
      const owned = this.profile.own(s.id);
      const weaponButtons = s.weapons.map((wid) => {
        const w = this.bundle.data.weapons.get(wid);
        if (!w) return '';
        const equipped = this.profile.equippedFor(wid)?.skinId === s.id;
        return `<button class="btn ${equipped ? 'gold' : ''}" style="padding:6px 8px;font-size:8px" data-skin="${s.id}" data-weapon="${wid}">${equipped ? 'ĐANG DÙNG' : esc(w.displayName)}</button>`;
      }).join('');
      return `<div class="skin-card">
        <div class="swatches">${s.palette.slice(0, 4).map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</div>
        <div class="rarity">${esc(s.rarity)} · ${esc(s.collection)}</div>
        <h4>${esc(s.name)}</h4>
        <div class="weapons">${s.weapons.map((w) => esc(this.bundle.data.weapons.get(w)?.displayName ?? w)).join(' · ')}</div>
        <div class="row"><span class="owned">${owned ? 'SỞ HỮU' : 'CHƯA SỞ HỮU'}</span></div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap">${owned ? weaponButtons : '<span class="owned" style="color:var(--muted)">Mở khóa qua thị trường (M12)</span>'}</div>
      </div>`;
    }).join('');
    grid.querySelectorAll<HTMLButtonElement>('[data-skin]').forEach((b) => {
      b.addEventListener('click', () => {
        const skin = skins.find((s) => s.id === b.dataset.skin);
        const wid = b.dataset.weapon!;
        if (!skin) return;
        const already = this.profile.equippedFor(wid)?.skinId === skin.id;
        const inst: SkinInstance | null = already ? null : { skinId: skin.id, patternSeed: (Math.random() * 1000) | 0, wear: Math.random() * 0.55 };
        this.profile.equip(wid, inst);
        this.cb.onEquip(wid, inst);
        this.buildArmoryGrid();
        this.toast(already ? 'Đã tháo skin' : `Đã trang bị ${skin.name}`);
        this.cb.onSettingsChanged();
      });
    });
  }

  private buildSettings(): void {
    const s = this.settings.value;
    const el = this.addScreen('settings', `
      <div class="subpage">
        <div class="subpage-head">
          <div><h1>Cài đặt</h1><p style="margin:4px 0 0;color:var(--muted);font-size:12px">Thay đổi được lưu cục bộ. Preset đồ hoạ không thay đổi độ che khuất của khói hay độ chói flash.</p></div>
          <button class="btn ghost" data-act="back">← Quay lại</button>
        </div>
        <div class="subpage-body"><div class="settings-grid">
          <div class="panel settings-card"><h3>// ĐỒ HOẠ</h3>
            <div class="preset-grid" id="preset-grid">
              ${(['competitive', 'low', 'medium', 'high', 'ultra'] as const).map((p) => `<button data-preset="${p}" class="${s.graphics.preset === p ? 'on' : ''}">${p.toUpperCase()}</button>`).join('')}
            </div>
            <div class="setting" style="margin-top:14px"><label>FOV</label><input id="set-fov" type="range" min="60" max="110" value="${s.fov}" /><span class="val" id="v-fov">${s.fov}</span></div>
            <div class="setting"><label>Độ nhạy chuột</label><input id="set-sens" type="range" min="0.3" max="6" step="0.1" value="${s.sensitivity}" /><span class="val" id="v-sens">${s.sensitivity.toFixed(1)}</span></div>
            <div class="setting"><label>Độ nhạy khi scope</label><input id="set-zoomsens" type="range" min="0.2" max="1.5" step="0.05" value="${s.zoomSensitivityMultiplier}" /><span class="val" id="v-zoomsens">${s.zoomSensitivityMultiplier.toFixed(2)}</span></div>
            <div class="setting"><label>Đảo trục Y</label><select id="set-invert"><option value="0" ${!s.invertY ? 'selected' : ''}>Tắt</option><option value="1" ${s.invertY ? 'selected' : ''}>Bật</option></select><span></span></div>
            <div class="setting" style="grid-template-columns:1fr"><label style="color:var(--muted);font-size:11px">Fairness: độ dày/độ mờ khói, thời gian flash và hitbox giống nhau ở mọi preset.</label></div>
          </div>
          <div class="panel settings-card"><h3>// ÂM THANH</h3>
            <div class="setting"><label>Master</label><input id="set-vol-master" type="range" min="0" max="1" step="0.05" value="${s.audio.master}" /><span class="val" id="v-master">${Math.round(s.audio.master * 100)}</span></div>
            <div class="setting"><label>Hiệu ứng</label><input id="set-vol-sfx" type="range" min="0" max="1" step="0.05" value="${s.audio.sfx}" /><span class="val" id="v-sfx">${Math.round(s.audio.sfx * 100)}</span></div>
            <div class="setting"><label>Môi trường</label><input id="set-vol-amb" type="range" min="0" max="1" step="0.05" value="${s.audio.music}" /><span class="val" id="v-amb">${Math.round(s.audio.music * 100)}</span></div>
            <div class="setting" style="grid-template-columns:1fr"><label style="color:var(--muted);font-size:11px">Âm thanh được tổng hợp bằng WebAudio — không dùng file ngoài.</label></div>
          </div>
          <div class="panel settings-card"><h3>// GIAO DIỆN</h3>
            <div class="setting"><label>Màu tâm ngắm</label><input id="set-cross-color" type="text" value="${esc(s.hud.crosshair.color)}" /><span></span></div>
            <div class="setting"><label>Khoảng hở tâm</label><input id="set-cross-gap" type="range" min="1" max="14" value="${s.hud.crosshair.gap}" /><span class="val" id="v-gap">${s.hud.crosshair.gap}</span></div>
            <div class="setting"><label>Hiện FPS</label><select id="set-showfps"><option value="0" ${!s.hud.showFps ? 'selected' : ''}>Tắt</option><option value="1" ${s.hud.showFps ? 'selected' : ''}>Bật</option></select><span></span></div>
            <div class="setting"><label>Giảm chuyển động</label><select id="set-reduced"><option value="0" ${!s.gameplay.reducedMotion ? 'selected' : ''}>Tắt</option><option value="1" ${s.gameplay.reducedMotion ? 'selected' : ''}>Bật</option></select><span></span></div>
          </div>
          <div class="panel settings-card"><h3>// TRỢ NĂNG</h3>
            <div class="setting"><label>Bảng màu mù màu</label><select id="set-colorblind">
              <option value="off" ${s.accessibility.colorBlind === 'off' ? 'selected' : ''}>Mặc định (vàng/lam)</option>
              <option value="deuteranopia" ${s.accessibility.colorBlind === 'deuteranopia' ? 'selected' : ''}>Deuteranopia</option>
              <option value="protanopia" ${s.accessibility.colorBlind === 'protanopia' ? 'selected' : ''}>Protanopia</option>
              <option value="tritanopia" ${s.accessibility.colorBlind === 'tritanopia' ? 'selected' : ''}>Tritanopia</option>
            </select><span></span></div>
            <div class="setting"><label>Phụ đề âm thanh</label><select id="set-subtitles"><option value="0" ${!s.accessibility.subtitles ? 'selected' : ''}>Tắt</option><option value="1" ${s.accessibility.subtitles ? 'selected' : ''}>Bật</option></select><span></span></div>
            <div class="setting"><label>Tương phản cao</label><select id="set-contrast"><option value="0" ${!s.accessibility.highContrast ? 'selected' : ''}>Tắt</option><option value="1" ${s.accessibility.highContrast ? 'selected' : ''}>Bật</option></select><span></span></div>
            <div class="setting"><label>Cỡ HUD</label><input id="set-hudscale" type="range" min="0.85" max="1.25" step="0.05" value="${s.accessibility.uiScale}" /><span class="val" id="v-hudscale">${Math.round(s.accessibility.uiScale * 100)}%</span></div>
            <div class="setting" style="grid-template-columns:1fr"><label style="color:var(--muted);font-size:11px">Phụ đề mô tả tiếng súng/bước chân theo hướng tương đối. Preset đồ hoạ không ảnh hưởng các trợ năng này.</label></div>
          </div>
          <div class="panel settings-card"><h3>// DỮ LIỆU</h3>
            <p style="color:var(--muted);font-size:12px;line-height:1.6">Hồ sơ cục bộ: <b>${esc(this.profile.value.name)}</b><br/>Credits: <b>${fmt(this.profile.value.credits)}</b><br/>Skin sở hữu: <b>${this.profile.value.ownedSkins.length}</b></p>
            <div class="row" style="display:flex;gap:8px"><button class="btn ghost" id="reset-settings">Đặt lại cài đặt</button><button class="btn danger" id="reset-profile">Xoá hồ sơ</button></div>
          </div>
        </div></div>
      </div>`);
    el.querySelector('[data-act="back"]')?.addEventListener('click', () => this.applySettingsAndBack());
    const bind = (id: string, fn: (v: string) => void): void => {
      const input = el.querySelector<HTMLInputElement>(id);
      input?.addEventListener('input', () => fn(input.value));
    };
    bind('#set-fov', (v) => { this.settings.value.fov = Number(v); (el.querySelector('#v-fov') as HTMLElement).textContent = v; this.cb.onSettingsChanged(); });
    bind('#set-sens', (v) => { this.settings.value.sensitivity = Number(v); (el.querySelector('#v-sens') as HTMLElement).textContent = Number(v).toFixed(1); this.cb.onSettingsChanged(); });
    bind('#set-zoomsens', (v) => { this.settings.value.zoomSensitivityMultiplier = Number(v); (el.querySelector('#v-zoomsens') as HTMLElement).textContent = Number(v).toFixed(2); this.cb.onSettingsChanged(); });
    bind('#set-cross-color', (v) => { this.settings.value.hud.crosshair.color = v; this.cb.onSettingsChanged(); });
    bind('#set-cross-gap', (v) => { this.settings.value.hud.crosshair.gap = Number(v); (el.querySelector('#v-gap') as HTMLElement).textContent = v; this.cb.onSettingsChanged(); });
    bind('#set-vol-master', (v) => { this.settings.value.audio.master = Number(v); (el.querySelector('#v-master') as HTMLElement).textContent = String(Math.round(Number(v) * 100)); this.cb.onSettingsChanged(); });
    bind('#set-vol-sfx', (v) => { this.settings.value.audio.sfx = Number(v); (el.querySelector('#v-sfx') as HTMLElement).textContent = String(Math.round(Number(v) * 100)); this.cb.onSettingsChanged(); });
    bind('#set-vol-amb', (v) => { this.settings.value.audio.music = Number(v); (el.querySelector('#v-amb') as HTMLElement).textContent = String(Math.round(Number(v) * 100)); this.cb.onSettingsChanged(); });
    el.querySelector('#set-invert')?.addEventListener('change', (e) => { this.settings.value.invertY = (e.target as HTMLSelectElement).value === '1'; this.cb.onSettingsChanged(); });
    el.querySelector('#set-showfps')?.addEventListener('change', (e) => { this.settings.value.hud.showFps = (e.target as HTMLSelectElement).value === '1'; this.cb.onSettingsChanged(); });
    el.querySelector('#set-reduced')?.addEventListener('change', (e) => { this.settings.value.gameplay.reducedMotion = (e.target as HTMLSelectElement).value === '1'; this.cb.onSettingsChanged(); });
    el.querySelector('#set-colorblind')?.addEventListener('change', (e) => { this.settings.value.accessibility.colorBlind = (e.target as HTMLSelectElement).value as ClientSettings['accessibility']['colorBlind']; this.cb.onSettingsChanged(); });
    el.querySelector('#set-subtitles')?.addEventListener('change', (e) => { this.settings.value.accessibility.subtitles = (e.target as HTMLSelectElement).value === '1'; this.cb.onSettingsChanged(); });
    el.querySelector('#set-contrast')?.addEventListener('change', (e) => { this.settings.value.accessibility.highContrast = (e.target as HTMLSelectElement).value === '1'; this.cb.onSettingsChanged(); });
    bind('#set-hudscale', (v) => { this.settings.value.accessibility.uiScale = Number(v); (el.querySelector('#v-hudscale') as HTMLElement).textContent = `${Math.round(Number(v) * 100)}%`; this.cb.onSettingsChanged(); });
    el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      this.settings.value.graphics.preset = b.dataset.preset as typeof this.settings.value.graphics.preset;
      el.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('on', x === b));
      this.cb.onSettingsChanged();
    }));
    el.querySelector('#reset-settings')?.addEventListener('click', () => {
      this.settings.reset(this.bundle.settings as unknown as ClientSettings);
      location.reload();
    });
    el.querySelector('#reset-profile')?.addEventListener('click', () => {
      localStorage.removeItem('tacticalstrike.profile.v1');
      location.reload();
    });
  }

  private fillSettings(): void {
    // giá trị đã được render lúc tạo; đồng bộ khi mở lại
    const el = this.elements.settings;
    if (!el) return;
  }

  private applySettingsAndBack(): void {
    this.settings.save();
    this.cb.onSettingsChanged();
    if (this.gameActive) { this.show(''); this.showPause(); } else this.show('main');
  }

  private buildAbout(): void {
    this.addScreen('about', `
      <div class="subpage">
        <div class="subpage-head"><div><h1>Giới thiệu</h1><p style="margin:4px 0 0;color:var(--muted);font-size:12px">TACTICAL STRIKE · bản dựng 0.1.0</p></div><button class="btn ghost" data-act="back">← Quay lại</button></div>
        <div class="subpage-body"><div class="about-cols">
          <div class="panel settings-card">
            <h3>// NGUYÊN TẮC NỘI DUNG</h3>
            <p>TACTICAL STRIKE là IP gốc. Toàn bộ tên gọi, bản đồ, vũ khí, skin, âm thanh và mô hình đều do dự án tạo ra. Không sử dụng tài sản, logo, bản đồ, âm thanh hay tên nhân vật từ bất kỳ trò chơi nào khác.</p>
            <p>Art hiện tại là procedural placeholder có watermark trong asset manifest; thay thế bằng asset cuối trước khi phát hành thương mại. Xem <b>ASSET_BRIEF.md</b>.</p>
            <p>Tiền tệ trong game là <b>Credits</b>, không quy đổi tiền thật. Các tính năng nạp tiền thật, loot box, giao dịch trực tiếp, voice chat và skin do người dùng tạo đang <b>TẮT</b>.</p>
          </div>
          <div class="panel settings-card">
            <h3>// CHECKLIST TRƯỚC KHI BẬT FLAG</h3>
            <ul class="checklist">
              <li>Xác minh yêu cầu pháp lý tại quốc gia phát hành</li>
              <li>Điều khoản dịch vụ + chính sách riêng tư đã duyệt</li>
              <li>Hệ thống thanh toán, hoàn tiền, thuế và KYC (nếu áp dụng)</li>
              <li>Giới hạn độ tuổi, hiển thị tỷ lệ và bảo vệ người chơi</li>
              <li>Nhật ký giao dịch, chống gian lận, xử lý tranh chấp</li>
              <li>Kiểm thử tải và giám sát trước khi mở</li>
            </ul>
            <p style="margin-top:12px">Đây là danh sách cần kiểm tra, không phải tư vấn pháp lý.</p>
            <div class="brief-stats" style="margin-top:12px"><div><b>0</b><span>FLAGS BẬT</span></div><div><b>0</b><span>GIAO DỊCH THẬT</span></div></div>
          </div>
        </div></div>
      </div>`).querySelector('[data-act="back"]')?.addEventListener('click', () => this.show('main'));
  }

  private buildPause(): void {
    this.addScreen('pause', `
      <div class="overlay-screen open" style="display:none" id="pause-overlay">
        <div class="dialog">
          <h2>Tạm dừng</h2>
          <p id="pause-sub">Trận đấu đang tạm dừng cục bộ.</p>
          <div class="stack">
            <button class="btn gold" data-act="resume">Tiếp tục</button>
            <div class="row"><button class="btn" data-act="settings">Cài đặt</button><button class="btn" data-act="restart">Chơi lại</button></div>
            <button class="btn danger" data-act="quit">Rời trận</button>
          </div>
        </div>
      </div>`);
    const el = this.elements.pause!;
    el.querySelector('[data-act="resume"]')?.addEventListener('click', () => this.cb.onResume());
    el.querySelector('[data-act="quit"]')?.addEventListener('click', () => this.cb.onQuit());
    el.querySelector('[data-act="restart"]')?.addEventListener('click', () => this.cb.onRestart());
    el.querySelector('[data-act="settings"]')?.addEventListener('click', () => { this.hidePause(); this.fillSettings(); this.show('settings'); });
  }

  private buildResults(): void {
    this.addScreen('results', `
      <div class="overlay-screen open" style="display:none">
        <div class="dialog results">
          <div class="verdict" id="res-verdict">TRẬN ĐẤU KẾT THÚC</div>
          <h1 id="res-title">Chiến thắng</h1>
          <div class="scoreline"><span class="t" id="res-t">0</span><span style="color:var(--muted);font-size:16px">:</span><span class="ct" id="res-ct">0</span><span style="font-size:10px;color:var(--muted);letter-spacing:2px;margin-left:8px">T / CT</span></div>
          <div class="statgrid">
            <div><b id="res-kills">0</b><span>KILLS</span></div>
            <div><b id="res-deaths">0</b><span>DEATHS</span></div>
            <div><b id="res-hs">0%</b><span>HEADSHOT</span></div>
            <div><b id="res-damage">0</b><span>DAMAGE</span></div>
          </div>
          <div class="row" style="margin-top:16px"><button class="btn gold" data-act="again">Chơi lại</button><button class="btn" data-act="menu">Về menu</button></div>
        </div>
      </div>`);
    const el = this.elements.results!;
    el.querySelector('[data-act="again"]')?.addEventListener('click', () => this.cb.onRestart());
    el.querySelector('[data-act="menu"]')?.addEventListener('click', () => this.cb.onQuit());
  }

  private buildToast(): void {
    const t = document.createElement('div');
    t.className = 'toast';
    this.screenHost.appendChild(t);
    this.elements.toast = t;
  }

  show(name: string): void {
    for (const [id, el] of Object.entries(this.elements)) {
      if (id === 'toast') continue;
      if (!(el instanceof HTMLElement) || !el.classList.contains('screen')) continue;
      el.classList.toggle('active', id === name);
    }
    if (name === 'main') this.refreshProfile();
    if (name === 'setup') this.refreshSetup();
  }

  hideAll(): void { this.show(''); }

  refreshProfile(): void {
    const name = document.querySelector('#profile-name');
    if (name) name.textContent = this.profile.value.name.toUpperCase();
    const credits = document.querySelector('#profile-credits');
    if (credits) credits.textContent = `${fmt(this.profile.value.credits)} Credits`;
    const m = document.querySelector('#stat-matches');
    if (m) m.textContent = String(this.profile.value.stats.matches);
    const w = document.querySelector('#stat-wins');
    if (w) w.textContent = String(this.profile.value.stats.wins);
    this.refreshSetup();
  }

  setStatus(text: string, backend?: string): void {
    const s = document.querySelector('#main-status');
    if (s) s.textContent = text;
    if (backend) {
      const b = document.querySelector('#backend-status');
      if (b) b.textContent = backend;
    }
  }

  setBackendInfo(backend: string, gpu: string): void {
    const b = document.querySelector('#backend-status');
    if (b) b.textContent = `${backend.toUpperCase()} · ${gpu}`;
    const s = document.querySelector('#main-status');
    if (s) s.textContent = 'Hệ thống sẵn sàng. Chọn "Chơi với bot" để bắt đầu.';
  }

  showPause(scoreText = ''): void {
    const el = this.elements.pause!;
    el.style.display = 'block';
    const overlay = el.querySelector('#pause-overlay') as HTMLElement | null;
    if (overlay) overlay.style.display = 'flex';
    const sub = el.querySelector('#pause-sub');
    if (sub) sub.textContent = scoreText || 'Trận đấu đang tạm dừng cục bộ.';
  }

  hidePause(): void {
    const el = this.elements.pause;
    if (el) {
      el.style.display = 'none';
      const overlay = el.querySelector('#pause-overlay') as HTMLElement | null;
      if (overlay) overlay.style.display = 'none';
    }
  }

  showResults(stats: { won: boolean; scoreT: number; scoreCT: number; kills: number; deaths: number; headshots: number; damage: number }): void {
    const el = this.elements.results!;
    el.classList.add('active');
    const overlay = el.querySelector('.overlay-screen') as HTMLElement;
    overlay.style.display = 'flex';
    (el.querySelector('#res-title') as HTMLElement).textContent = stats.won ? 'Chiến thắng' : 'Thất bại';
    (el.querySelector('#res-title') as HTMLElement).style.color = stats.won ? 'var(--accent)' : 'var(--danger)';
    (el.querySelector('#res-t') as HTMLElement).textContent = String(stats.scoreT);
    (el.querySelector('#res-ct') as HTMLElement).textContent = String(stats.scoreCT);
    (el.querySelector('#res-kills') as HTMLElement).textContent = String(stats.kills);
    (el.querySelector('#res-deaths') as HTMLElement).textContent = String(stats.deaths);
    (el.querySelector('#res-hs') as HTMLElement).textContent = `${stats.kills ? Math.round(stats.headshots / stats.kills * 100) : 0}%`;
    (el.querySelector('#res-damage') as HTMLElement).textContent = String(Math.round(stats.damage));
  }

  hideResults(): void {
    const el = this.elements.results;
    if (!el) return;

    el.classList.remove('active');
    const overlay = el.querySelector('.overlay-screen') as HTMLElement;
    if (overlay) overlay.style.display = 'none';
  }

  toast(text: string, error = false): void {
    const t = this.elements.toast;
    if (!t) return;
    t.textContent = text;
    t.classList.toggle('error', error);
    t.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
  }

  currentSetup(): typeof this.setupState { return { ...this.setupState }; }
}
