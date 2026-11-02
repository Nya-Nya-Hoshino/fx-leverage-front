// 可序列化的带种子随机数生成器（sfc32）。所有影响行情/成交的随机性都必须经过它，
// 以便存档后能从完全相同的生成器状态继续。

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: number[]) {
    [this.a, this.b, this.c, this.d] = state.map((x) => x >>> 0);
  }

  static fromSeed(seed: number): Rng {
    // splitmix32 扩展种子
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    const r = new Rng([next(), next(), next(), next()]);
    for (let i = 0; i < 12; i++) r.next();
    return r;
  }

  getState(): number[] {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  next(): number {
    let a = this.a, b = this.b, c = this.c, d = this.d;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }

  /** 标准正态（Box-Muller，不缓存第二个值，保持状态简单） */
  normal(): number {
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  exp(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }
}
