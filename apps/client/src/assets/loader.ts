import * as THREE from 'three';

export type AssetStatus = 'pending' | 'ready' | 'fallback';

export interface AssetItem {
  key: string;
  kind: 'texture' | 'geometry' | 'audio';
  status: AssetStatus;
  bytes: number;
  note?: string;
}

type ProgressFn = (loaded: number, total: number, label: string) => void;

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D không khả dụng');
  return [c, ctx];
}

/** PRNG nội bộ để texture tất định. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(ctx: CanvasRenderingContext2D, size: number, count: number, rand: () => number, alpha: number, colors: string[]): void {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.35 + rand() * 0.65);
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)]!;
    const x = rand() * size, y = rand() * size;
    const r = 0.4 + rand() * 2.6;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function makeSandstone(rand: () => number): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#b78a52'; ctx.fillRect(0, 0, size, size);
  const rows = 8, rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * 64;
    for (let cx = -1; cx < 5; cx++) {
      const x = cx * 128 + offset;
      const tint = 0.9 + rand() * 0.18;
      ctx.fillStyle = `rgb(${Math.round(178 * tint)},${Math.round(136 * tint)},${Math.round(84 * tint)})`;
      ctx.fillRect(x + 2, r * rowH + 2, 124, rowH - 4);
      ctx.strokeStyle = 'rgba(70,48,26,0.55)'; ctx.lineWidth = 2; ctx.strokeRect(x + 2, r * rowH + 2, 124, rowH - 4);
      ctx.strokeStyle = 'rgba(255,225,180,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 4, r * rowH + 5); ctx.lineTo(x + 122, r * rowH + 5); ctx.stroke();
    }
  }
  speckle(ctx, size, 2600, rand, 0.22, ['#6e4e2b', '#dfb87a', '#8a6438', '#c79a5d']);
  // vết nứt
  ctx.strokeStyle = 'rgba(58,40,22,0.45)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 12; i++) {
    let x = rand() * size, y = rand() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (rand() - 0.5) * 46; y += (rand() - 0.5) * 46; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return c;
}

function makeConcrete(rand: () => number): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#9d9c96'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 34; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.09;
    ctx.fillStyle = rand() > 0.5 ? '#ffffff' : '#4d4b46';
    const x = rand() * size, y = rand() * size, r = 18 + rand() * 100;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckle(ctx, size, 3000, rand, 0.3, ['#5a5954', '#c4c2bb', '#777671']);
  ctx.strokeStyle = 'rgba(50,49,46,0.35)';
  for (let i = 0; i < 7; i++) {
    ctx.lineWidth = 1 + rand() * 2;
    let x = rand() * size, y = rand() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (rand() - 0.5) * 60; y += rand() * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return c;
}

function makeMetal(rand: () => number): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#697077'; ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 2) {
    ctx.globalAlpha = 0.06 + rand() * 0.06;
    ctx.fillStyle = rand() > 0.5 ? '#c4ccd3' : '#2e3439';
    ctx.fillRect(x, 0, 1, size);
  }
  ctx.globalAlpha = 1;
  speckle(ctx, size, 900, rand, 0.25, ['#3a4147', '#aeb7be', '#7d4a2a']);
  // vết gỉ
  for (let i = 0; i < 16; i++) {
    ctx.globalAlpha = 0.1 + rand() * 0.18;
    ctx.fillStyle = '#8a4c25';
    const x = rand() * size, y = rand() * size;
    ctx.beginPath(); ctx.ellipse(x, y, 6 + rand() * 30, 3 + rand() * 14, rand() * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

function makeWood(rand: () => number): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#8a6136'; ctx.fillRect(0, 0, size, size);
  for (let p = 0; p < 6; p++) {
    const y0 = p * 85;
    ctx.fillStyle = `rgba(${110 + rand() * 40},${74 + rand() * 26},${38 + rand() * 18},0.5)`;
    ctx.fillRect(0, y0, size, 82);
    ctx.strokeStyle = 'rgba(58,38,18,0.65)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(size, y0); ctx.stroke();
    for (let i = 0; i < 24; i++) {
      ctx.strokeStyle = `rgba(${60 + rand() * 40},${40 + rand() * 25},${20 + rand() * 10},${0.12 + rand() * 0.18})`;
      ctx.lineWidth = 0.8 + rand() * 1.4;
      const y = y0 + 8 + rand() * 66;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + (rand() - 0.5) * 8, size * 0.7, y + (rand() - 0.5) * 8, size, y + (rand() - 0.5) * 5);
      ctx.stroke();
    }
  }
  speckle(ctx, size, 700, rand, 0.2, ['#4a3018', '#c99a63']);
  return c;
}

function makeSand(rand: () => number): HTMLCanvasElement {
  const size = 512;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#b39567'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.08;
    ctx.fillStyle = rand() > 0.4 ? '#d8c193' : '#8b744e';
    const x = rand() * size, y = rand() * size, r = 8 + rand() * 50;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.45, rand() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckle(ctx, size, 4200, rand, 0.25, ['#7b6544', '#e3cea2', '#9d855c']);
  return c;
}

function makeFabric(base: string, accent: string, rand: () => number): HTMLCanvasElement {
  const size = 256;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 0.2;
  for (let y = 0; y < size; y += 3) { ctx.fillStyle = y % 6 === 0 ? '#000' : '#fff'; ctx.fillRect(0, y, size, 1); }
  for (let x = 0; x < size; x += 3) { ctx.fillStyle = x % 6 === 0 ? '#000' : '#fff'; ctx.fillRect(x, 0, 1, size); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent; ctx.fillRect(0, size * 0.62, size, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, size * 0.72, size, 4);
  speckle(ctx, size, 500, rand, 0.12, ['#000000', '#ffffff']);
  return c;
}

function makeSmoke(rand: () => number): HTMLCanvasElement {
  const size = 256;
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(228,224,214,0.95)');
  g.addColorStop(0.35, 'rgba(205,200,190,0.7)');
  g.addColorStop(0.7, 'rgba(176,172,164,0.28)');
  g.addColorStop(1, 'rgba(160,158,150,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  // cục bông khói
  for (let i = 0; i < 90; i++) {
    const x = size / 2 + (rand() - 0.5) * size * 0.62;
    const y = size / 2 + (rand() - 0.5) * size * 0.62;
    const r = 10 + rand() * 42;
    const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
    if (d > 0.9) continue;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(235,232,224,${0.1 * (1 - d)})`);
    rg.addColorStop(1, 'rgba(235,232,224,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function makeFlash(rand: () => number): HTMLCanvasElement {
  const size = 128;
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,238,190,0.95)');
  g.addColorStop(0.6, 'rgba(255,180,80,0.35)');
  g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,230,0.9)';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rand() * 0.2;
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath(); ctx.moveTo(64, 64);
    ctx.lineTo(64 + Math.cos(a) * (30 + rand() * 30), 64 + Math.sin(a) * (30 + rand() * 30)); ctx.stroke();
  }
  return c;
}

function makeHole(rand: () => number): HTMLCanvasElement {
  const size = 128;
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(20,16,12,0.92)';
  ctx.beginPath(); ctx.arc(64, 64, 11 + rand() * 4, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
  g.addColorStop(0, 'rgba(70,58,46,0.6)');
  g.addColorStop(0.5, 'rgba(120,105,86,0.2)');
  g.addColorStop(1, 'rgba(120,105,86,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 20; i++) {
    ctx.strokeStyle = `rgba(40,32,24,${0.2 + rand() * 0.3})`; ctx.lineWidth = 1;
    const a = rand() * Math.PI * 2, r = 12 + rand() * 34;
    ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * 10, 64 + Math.sin(a) * 10);
    ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); ctx.stroke();
  }
  return c;
}

function makeSiteLetter(letter: string): HTMLCanvasElement {
  const size = 256;
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, size, size);
  ctx.font = 'bold 190px ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(20,16,10,0.55)'; ctx.lineWidth = 12; ctx.strokeText(letter, 128, 136);
  ctx.fillStyle = 'rgba(224,180,66,0.86)'; ctx.fillText(letter, 128, 136);
  return c;
}

function makeBumpFrom(base: HTMLCanvasElement, rand: () => number): HTMLCanvasElement {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 256, 256);
  const src = base.getContext('2d');
  if (src) {
    const data = src.getImageData(0, 0, base.width, base.height);
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const sx = Math.floor((x / 256) * base.width), sy = Math.floor((y / 256) * base.height);
        const i = (sy * base.width + sx) * 4;
        const l = data.data[i]! * 0.33 + data.data[i + 1]! * 0.5 + data.data[i + 2]! * 0.17;
        const o = (y * 256 + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 70 + l * 0.55;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  } else {
    speckle(ctx, 256, 4000, rand, 0.5, ['#000000', '#ffffff']);
  }
  return c;
}

export class AssetLoader {
  readonly textures = new Map<string, THREE.Texture>();
  readonly manifest: AssetItem[] = [];
  readonly errors: string[] = [];
  private readonly objects: THREE.Texture[] = [];

  private tex(key: string, src: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: number; pixels?: boolean } = {}): void {
    const t = new THREE.CanvasTexture(src);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (opts.repeat) t.repeat.set(opts.repeat, opts.repeat);
    if (opts.pixels) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; }
    this.textures.set(key, t);
    this.objects.push(t);
    this.manifest.push({ key, kind: 'texture', status: 'ready', bytes: 0 });
  }

  async loadAll(onProgress?: ProgressFn): Promise<void> {
    const steps: { label: string; run: () => void }[] = [
      { label: 'Đá sa thạch', run: () => { const r = rng(11); const c = makeSandstone(r); this.tex('sandstone', c); this.tex('sandstone_bump', makeBumpFrom(c, r), { srgb: false }); } },
      { label: 'Bê tông', run: () => { const r = rng(22); const c = makeConcrete(r); this.tex('concrete', c); this.tex('concrete_bump', makeBumpFrom(c, r), { srgb: false }); } },
      { label: 'Kim loại', run: () => { const r = rng(33); const c = makeMetal(r); this.tex('metal', c); this.tex('metal_bump', makeBumpFrom(c, r), { srgb: false }); } },
      { label: 'Gỗ', run: () => { const r = rng(44); const c = makeWood(r); this.tex('wood', c); this.tex('wood_bump', makeBumpFrom(c, r), { srgb: false }); } },
      { label: 'Cát', run: () => { const r = rng(55); const c = makeSand(r); this.tex('sand', c); this.tex('sand_bump', makeBumpFrom(c, r), { srgb: false }); } },
      { label: 'Vải chiến thuật', run: () => { const r = rng(66); this.tex('fabric_t', makeFabric('#8a7444', '#d8a63a', r)); this.tex('fabric_ct', makeFabric('#4d5a66', '#6fa8d6', r)); } },
      { label: 'Khói', run: () => { this.tex('smoke', makeSmoke(rng(77)), { srgb: true }); } },
      { label: 'Chớp', run: () => { this.tex('flash', makeFlash(rng(88)), { srgb: true }); } },
      { label: 'Lỗ đạn', run: () => { const t = new THREE.CanvasTexture(makeHole(rng(99))); t.colorSpace = THREE.SRGBColorSpace; this.textures.set('hole', t); this.objects.push(t); this.manifest.push({ key: 'hole', kind: 'texture', status: 'ready', bytes: 0 }); } },
      { label: 'Ký hiệu site', run: () => {
        for (const l of ['A', 'B']) {
          const t = new THREE.CanvasTexture(makeSiteLetter(l)); t.colorSpace = THREE.SRGBColorSpace;
          this.textures.set(`site_${l.toLowerCase()}`, t); this.objects.push(t);
          this.manifest.push({ key: `site_${l.toLowerCase()}`, kind: 'texture', status: 'ready', bytes: 0 });
        }
      } },
    ];
    let done = 0;
    for (const step of steps) {
      await new Promise((r) => setTimeout(r, 0));
      try {
        step.run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.errors.push(`${step.label}: ${msg}`);
        this.textures.set(step.label, this.fallbackTexture());
      }
      done++;
      onProgress?.(done, steps.length, step.label);
    }
  }

  get(key: string): THREE.Texture {
    const t = this.textures.get(key);
    if (t) return t;
    this.errors.push(`Thiếu texture ${key}, dùng fallback`);
    this.manifest.push({ key, kind: 'texture', status: 'fallback', bytes: 0, note: 'texture dự phòng' });
    const fb = this.fallbackTexture();
    this.textures.set(key, fb);
    return fb;
  }

  private fallbackTexture(): THREE.Texture {
    const [c, ctx] = canvas(64);
    ctx.fillStyle = '#b02a6a'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#14161a'; ctx.font = 'bold 11px monospace'; ctx.fillText('PLACEHOLDER', 1, 56);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    this.objects.push(t);
    return t;
  }

  missing(): boolean { return this.errors.length > 0; }

  dispose(): void {
    for (const t of this.objects) t.dispose();
    this.textures.clear();
  }
}
