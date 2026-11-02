// 模拟时钟：交易时段、周末休市、每日换日（掉期结算）时刻。
import type { SessionFlags } from '../../shared/types';

/** 游戏起始时间：2031-01-06 00:00 UTC（周一，东京 09:00） */
export const START_T = Date.UTC(2031, 0, 6, 0, 0, 0) / 1000;
export const ROLLOVER_HOUR = 21; // UTC 21:00 = 纽约 17:00

function d(t: number) {
  return new Date(t * 1000);
}

export function utcHour(t: number): number {
  const x = d(t);
  return x.getUTCHours() + x.getUTCMinutes() / 60 + x.getUTCSeconds() / 3600;
}

export function weekday(t: number): number {
  return d(t).getUTCDay();
}

/** 周五 21:00 UTC 收市，周日 21:00 UTC 开市 */
export function isMarketOpen(t: number): boolean {
  const dow = weekday(t);
  const h = utcHour(t);
  if (dow === 6) return false;
  if (dow === 5 && h >= ROLLOVER_HOUR) return false;
  if (dow === 0 && h < ROLLOVER_HOUR) return false;
  return true;
}

/** 下一次开市时间（若当前已开市返回 t） */
export function nextOpen(t: number): number {
  if (isMarketOpen(t)) return t;
  const x = d(t);
  const dow = x.getUTCDay();
  const daysToSun = (7 - dow) % 7;
  const sun = Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() + daysToSun, ROLLOVER_HOUR) / 1000;
  return sun > t ? sun : sun + 7 * 86400;
}

/** 下一次收市时间（周五 21:00） */
export function nextClose(t: number): number {
  const x = d(t);
  const dow = x.getUTCDay();
  const daysToFri = (5 - dow + 7) % 7;
  let fri = Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() + daysToFri, ROLLOVER_HOUR) / 1000;
  if (fri <= t) fri += 7 * 86400;
  return fri;
}

/** 区间 (t0, t1] 内经过的换日时刻列表（周一~周五 21:00 UTC） */
export function rolloversBetween(t0: number, t1: number): number[] {
  const out: number[] = [];
  const x = d(t0);
  let r = Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), ROLLOVER_HOUR) / 1000;
  if (r <= t0) r += 86400;
  for (; r <= t1; r += 86400) {
    const dow = weekday(r);
    if (dow >= 1 && dow <= 5) out.push(r);
  }
  return out;
}

/** 掉期天数：周三换日计 3 天 */
export function swapDays(rollover: number): number {
  return weekday(rollover) === 3 ? 3 : 1;
}

export function sessionFlags(t: number): SessionFlags {
  const h = utcHour(t);
  const open = isMarketOpen(t);
  const asia = open && (h >= 23 || h < 8);
  const europe = open && h >= 7 && h < 16;
  const us = open && h >= 12.5 && h < 21;
  const label = !open ? 'closed' : us && europe ? 'london-ny' : us ? 'newyork' : europe && asia ? 'tokyo-london' : europe ? 'london' : asia ? 'tokyo' : 'quiet';
  return { asia, europe, us, open, label };
}

/** 时段波动率倍数（按货币区域） */
export function sessionVol(t: number, region: string): number {
  const f = sessionFlags(t);
  if (!f.open) return 0;
  let m = 0.55;
  if (f.asia) m = Math.max(m, region === 'asia' || region === 'oceania' ? 1.05 : 0.7);
  if (f.europe) m = Math.max(m, region === 'europe' ? 1.3 : 1.0);
  if (f.us) m = Math.max(m, region === 'america' ? 1.3 : 1.05);
  if (f.europe && f.us) m *= 1.12;
  return m;
}

/** 时段流动性对应的点差倍数 */
export function sessionSpread(t: number): number {
  const h = utcHour(t);
  const f = sessionFlags(t);
  if (!f.open) return 1;
  // 换日前后（NY 收盘）流动性最差
  if (h >= 20.75 && h < 22.5) return 2.6;
  if (f.europe || f.us) return 1;
  if (f.asia) return 1.15;
  return 1.6;
}
