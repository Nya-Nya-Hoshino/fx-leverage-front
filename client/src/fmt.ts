import type { AccountCcy, Ccy, Quote } from '../../shared/types';
import { PAIR_MAP } from '../../shared/instruments';

export function money(v: number, ccy: AccountCcy | undefined, sign = false): string {
  if (!Number.isFinite(v)) return '∞';
  const dp = ccy === 'CNY' ? 2 : 0;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const sym = ccy === 'CNY' ? '¥' : '¥';
  const pre = v < 0 ? '-' : sign && v > 0 ? '+' : '';
  return `${pre}${sym}${s}`;
}

export function num(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function px(sym: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toFixed(PAIR_MAP[sym]?.digits ?? 5);
}

export function pairLabel(sym: string) {
  return `${sym.slice(0, 3)}/${sym.slice(3)}`;
}

/** 显示时区：JPY 账户用 JST，CNY 账户用北京时间 */
export function tzOffset(ccy?: AccountCcy) {
  return (ccy === 'CNY' ? 8 : 9) * 3600;
}

export function simTime(t: number, ccy?: AccountCcy, withDate = true) {
  const d = new Date((t + tzOffset(ccy)) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  if (!withDate) return time;
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}(${wd}) ${time}`;
}

/** 由 USD 直盘报价得到 1 单位货币 = ? USD（中间价），供前端估算 */
export function usdPerFromQuotes(quotes: Record<string, Quote>, c: Ccy): number {
  if (c === 'USD') return 1;
  const a = quotes[`USD${c}`];
  if (a) return 1 / a.mid;
  const b = quotes[`${c}USD`];
  if (b) return b.mid;
  return NaN;
}

export function convQ(quotes: Record<string, Quote>, from: Ccy, to: Ccy) {
  return usdPerFromQuotes(quotes, from) / usdPerFromQuotes(quotes, to);
}

export function acctMkt(ccy: AccountCcy): Ccy {
  return ccy === 'CNY' ? 'CNH' : 'JPY';
}
