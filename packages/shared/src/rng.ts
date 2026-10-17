/** RNG tất định (xorshift128+) — server sinh seed, client chỉ dự đoán hiển thị. */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed = 0x9e3779b9) {
    this.s0 = seed | 0; this.s1 = (seed ^ 0xdeadbeef) | 0;
    this.s2 = (seed ^ 0x1234567) | 0; this.s3 = (seed ^ 0x89abcdef) | 0;
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
    for (let i = 0; i < 12; i++) this.nextUint32();
  }
  nextUint32(): number {
    const t = (this.s1 << 9) | 0;
    let r = (this.s0 * 5) | 0;
    this.s0 = this.s1; this.s1 = this.s2; this.s2 = this.s3;
    this.s3 = (this.s3 ^ (this.s3 >>> 11)) ^ (this.s1 ^ t);
    r = (r + ((this.s3 * 5) | 0)) | 0;
    return r >>> 0;
  }
  nextFloat(): number { return this.nextUint32() / 4294967296; }
  range(min: number, max: number): number { return min + (max - min) * this.nextFloat(); }
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.nextFloat() * (maxInclusive - min + 1));
  }
  chance(p: number): boolean { return this.nextFloat() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.nextFloat() * arr.length)] as T; }
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Phân phối chuẩn (Box–Muller), dùng cho sai số ngắm của bot. */
export function gaussian(rng: Rng, mean = 0, stdDev = 1): number {
  let u = rng.nextFloat();
  if (u < 1e-9) u = 1e-9;
  const v = rng.nextFloat();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Phân phối log-normal lệch phải (thời gian phản ứng người). */
export function logNormal(rng: Rng, medianMs: number, sigma: number): number {
  return medianMs * Math.exp(sigma * gaussian(rng, 0, 1));
}
