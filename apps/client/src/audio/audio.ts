type Vec3 = { x: number; y: number; z: number };

interface PlayOpts {
  pos?: Vec3;
  volume?: number;
  rate?: number;
  refDist?: number;
  maxDist?: number;
  lowpass?: boolean;
}

/**
 * Âm thanh tổng hợp bằng WebAudio, không dùng file ngoài.
 * Mọi âm thanh đều là nội dung gốc, sinh bằng noise/oscillator.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambience!: GainNode;
  private noise!: AudioBuffer;
  private listenerPos: Vec3 = { x: 0, y: 1.6, z: 0 };
  private listenerYaw = 0;
  ready = false;
  volumes = { master: 0.8, sfx: 0.8, ambience: 0.35, voice: 0.9 };

  async unlock(): Promise<void> {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain(); this.master.gain.value = this.volumes.master;
    this.sfx = this.ctx.createGain(); this.sfx.gain.value = this.volumes.sfx;
    this.ambience = this.ctx.createGain(); this.ambience.gain.value = this.volumes.ambience;
    this.master.connect(this.ctx.destination);
    this.sfx.connect(this.master);
    this.ambience.connect(this.master);
    const len = Math.floor(this.ctx.sampleRate * 2);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ready = true;
    this.startAmbience();
  }

  setVolumes(v: Partial<typeof this.volumes>): void {
    Object.assign(this.volumes, v);
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.volumes.master, this.ctx.currentTime, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, this.ctx.currentTime, 0.05);
    this.ambience.gain.setTargetAtTime(this.volumes.ambience, this.ctx.currentTime, 0.05);
  }

  updateListener(pos: Vec3, yaw: number): void {
    this.listenerPos = pos;
    this.listenerYaw = yaw;
  }

  private outNode(opts: PlayOpts): { node: AudioNode; gain: GainNode } {
    if (!this.ctx) throw new Error('audio chưa mở');
    const gain = this.ctx.createGain();
    let volume = opts.volume ?? 1;
    let pan = 0;
    if (opts.pos) {
      const dx = opts.pos.x - this.listenerPos.x;
      const dy = opts.pos.y - this.listenerPos.y;
      const dz = opts.pos.z - this.listenerPos.z;
      const dist = Math.hypot(dx, dy, dz);
      const ref = opts.refDist ?? 6;
      const max = opts.maxDist ?? 70;
      volume *= Math.max(0, 1 - Math.max(0, dist - ref) / max) ** 1.6;
      // pan theo góc so với hướng nhìn
      const worldAngle = Math.atan2(dx, dz);
      const rel = Math.atan2(Math.sin(worldAngle - this.listenerYaw), Math.cos(worldAngle - this.listenerYaw));
      pan = Math.max(-0.9, Math.min(0.9, rel / (Math.PI / 2)));
    }
    gain.gain.value = volume;
    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(this.sfx);
    } else {
      gain.connect(this.sfx);
    }
    return { node: gain, gain };
  }

  private noiseBurst(dur: number, freq: number, q: number, volume: number, opts: PlayOpts, decay = 0.12): void {
    if (!this.ctx || !this.ready) return;
    const t = this.ctx.currentTime;
    const { node } = this.outNode(opts);
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = (opts.rate ?? 1) * (0.95 + Math.random() * 0.1);
    const filter = this.ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(node);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.02);
    void decay;
  }

  private tone(freq: number, dur: number, volume: number, opts: PlayOpts, type: OscillatorType = 'sine', endFreq?: number): void {
    if (!this.ctx || !this.ready) return;
    const t = this.ctx.currentTime;
    const { node } = this.outNode(opts);
    const osc = this.ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(node); osc.start(t); osc.stop(t + dur + 0.02);
  }

  play(name: string, opts: PlayOpts = {}): void {
    if (!this.ready) return;
    const vol = opts.volume ?? 1;
    switch (name) {
      case 'rifle':
        this.noiseBurst(0.16, 900, 0.7, 0.55 * vol, opts, 0.1);
        this.tone(120, 0.18, 0.5 * vol, opts, 'triangle', 48);
        this.noiseBurst(0.34, 2400, 1.4, 0.16 * vol, opts);
        break;
      case 'smg':
        this.noiseBurst(0.09, 1400, 0.9, 0.4 * vol, opts);
        this.tone(180, 0.1, 0.32 * vol, opts, 'square', 70);
        break;
      case 'pistol':
        this.noiseBurst(0.11, 1200, 0.8, 0.42 * vol, opts);
        this.tone(160, 0.12, 0.36 * vol, opts, 'triangle', 60);
        break;
      case 'heavy_pistol':
        this.noiseBurst(0.2, 800, 0.7, 0.6 * vol, opts);
        this.tone(90, 0.25, 0.55 * vol, opts, 'triangle', 40);
        break;
      case 'shotgun':
        this.noiseBurst(0.32, 600, 0.5, 0.7 * vol, opts);
        this.tone(70, 0.35, 0.55 * vol, opts, 'sine', 30);
        break;
      case 'sniper':
        this.noiseBurst(0.5, 500, 0.4, 0.8 * vol, opts);
        this.noiseBurst(0.18, 2200, 2.0, 0.35 * vol, opts);
        this.tone(65, 0.55, 0.6 * vol, opts, 'sine', 28);
        break;
      case 'knife':
        this.noiseBurst(0.07, 3200, 2.2, 0.25 * vol, opts);
        break;
      case 'dryfire':
        this.noiseBurst(0.035, 2600, 3.0, 0.2 * vol, opts);
        break;
      case 'reload_start':
        this.noiseBurst(0.04, 1900, 2.0, 0.22 * vol, opts);
        window.setTimeout(() => this.noiseBurst(0.05, 900, 1.4, 0.2 * vol, opts), 180);
        break;
      case 'reload_end':
        this.noiseBurst(0.06, 1400, 1.6, 0.3 * vol, opts);
        this.tone(320, 0.05, 0.12 * vol, opts, 'square', 220);
        break;
      case 'footstep':
        this.noiseBurst(0.07, opts.pos ? 380 : 300, 0.8, 0.16 * vol, { ...opts, rate: 0.7 + Math.random() * 0.5 }, 0.05);
        break;
      case 'land':
        this.noiseBurst(0.12, 240, 0.7, 0.24 * vol, opts);
        break;
      case 'jump':
        this.noiseBurst(0.06, 500, 0.8, 0.1 * vol, opts);
        break;
      case 'hit':
        this.tone(1100, 0.06, 0.22 * vol, opts, 'square', 900);
        break;
      case 'headshot':
        this.tone(1600, 0.09, 0.3 * vol, opts, 'sine', 900);
        this.tone(2400, 0.07, 0.16 * vol, opts, 'sine');
        break;
      case 'kill':
        this.tone(700, 0.1, 0.2 * vol, opts, 'triangle', 1000);
        break;
      case 'bomb_beep':
        this.tone(1480, 0.08, 0.26 * vol, opts, 'square');
        break;
      case 'bomb_planted':
        this.tone(520, 0.16, 0.3 * vol, opts, 'square', 380);
        window.setTimeout(() => this.tone(390, 0.22, 0.24 * vol, opts, 'square'), 200);
        break;
      case 'bomb_defused':
        this.tone(660, 0.12, 0.25 * vol, opts, 'triangle');
        window.setTimeout(() => this.tone(880, 0.2, 0.25 * vol, opts, 'triangle'), 140);
        break;
      case 'explosion':
        this.noiseBurst(0.55, 180, 0.5, 0.9 * vol, opts);
        this.tone(48, 0.7, 0.7 * vol, opts, 'sine', 22);
        this.noiseBurst(0.25, 900, 0.8, 0.4 * vol, opts);
        break;
      case 'flashbang':
        this.noiseBurst(0.18, 2000, 0.6, 0.7 * vol, opts);
        this.tone(1800, 0.4, 0.2 * vol, opts, 'sine', 300);
        break;
      case 'smoke_deploy':
        this.noiseBurst(0.5, 700, 0.5, 0.3 * vol, opts);
        break;
      case 'grenade_throw':
        this.noiseBurst(0.08, 1000, 1.2, 0.18 * vol, opts);
        break;
      case 'grenade_bounce':
        this.tone(420, 0.05, 0.1 * vol, opts, 'square', 300);
        break;
      case 'fire':
        this.tone(90, 0.4, 0.12 * vol, opts, 'sawtooth', 70);
        break;
      case 'scope':
        this.noiseBurst(0.03, 2800, 2.6, 0.14 * vol, opts);
        break;
      case 'ui_hover':
        this.tone(600, 0.025, 0.04 * vol, opts, 'sine');
        break;
      case 'ui_click':
        this.tone(760, 0.05, 0.08 * vol, opts, 'square', 520);
        break;
      case 'ui_back':
        this.tone(420, 0.06, 0.07 * vol, opts, 'square', 260);
        break;
      case 'buy':
        this.tone(880, 0.06, 0.1 * vol, opts, 'triangle', 1200);
        break;
      case 'round_start':
        this.tone(320, 0.25, 0.18 * vol, opts, 'triangle', 420);
        window.setTimeout(() => this.tone(480, 0.3, 0.16 * vol, opts, 'triangle', 600), 220);
        break;
      case 'round_win':
        this.tone(520, 0.16, 0.2 * vol, opts, 'triangle', 660);
        window.setTimeout(() => this.tone(780, 0.3, 0.2 * vol, opts, 'triangle', 980), 160);
        break;
      case 'round_lose':
        this.tone(360, 0.25, 0.18 * vol, opts, 'triangle', 240);
        break;
      default:
        break;
    }
  }

  private startAmbience(): void {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 420; filter.Q.value = 0.4;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    src.connect(filter); filter.connect(g); g.connect(this.ambience);
    src.start();
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain); lfoGain.connect(g.gain); lfo.start();
  }
}
