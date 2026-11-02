// 技术指标：前端绘图与 AI/本地交易员共用同一实现。
import type { Candle } from './types';

export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

export function ema(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    if (prev === null) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += values[j];
      prev = s / n;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], n = 14): (number | null)[] {
  if (values.length === 0) return [];
  const out: (number | null)[] = [null];
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) {
      gain += g; loss += l;
      if (i === n) { gain /= n; loss /= n; out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)); }
      else out.push(null);
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
    }
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast), es = ema(values, slow);
  const line: (number | null)[] = values.map((_, i) => (ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null));
  const firstIdx = line.findIndex((x) => x !== null);
  const sig: (number | null)[] = values.map(() => null);
  if (firstIdx >= 0) {
    const sub = ema(line.slice(firstIdx) as number[], signal);
    sub.forEach((v, j) => (sig[firstIdx + j] = v));
  }
  const hist = line.map((v, i) => (v !== null && sig[i] !== null ? v - (sig[i] as number) : null));
  return { line, signal: sig, hist };
}

export function atr(c: Candle[], n = 14): (number | null)[] {
  const tr = c.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - c[i - 1].c), Math.abs(b.l - c[i - 1].c))));
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    if (prev === null) prev = tr.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else prev = (prev * (n - 1) + tr[i]) / n;
    out.push(prev);
  }
  return out;
}

export function bollinger(values: number[], n = 20, k = 2) {
  const mid = sma(values, n);
  const up: (number | null)[] = [], dn: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    const m = mid[i];
    if (m === null) { up.push(null); dn.push(null); continue; }
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (values[j] - m) ** 2;
    const sd = Math.sqrt(v / n);
    up.push(m + k * sd); dn.push(m - k * sd);
  }
  return { mid, up, dn };
}

export function last<T>(a: (T | null)[]): T | null {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null) return a[i];
  return null;
}
