import type { AccountCcy, Ccy, PairDef } from './types';

export const CCYS: Ccy[] = ['USD', 'JPY', 'EUR', 'GBP', 'CHF', 'AUD', 'NZD', 'CAD', 'CNH', 'HKD', 'TWD', 'KRW', 'SGD'];

export interface CcyInfo {
  name: { zh: string; ja: string };
  usdPer: number;     // 初始 1 单位货币 = ? USD
  sigma: number;      // 自身因子年化波动率
  peg: number;        // 对 USD 因子的挂钩权重（1 = 完全挂钩）
  risk: number;       // 风险情绪因子载荷（正 = 风险偏好时走强）
  euro: number;       // 欧洲区块因子载荷
  region: 'asia' | 'europe' | 'america' | 'oceania';
  rate: number;       // 初始政策利率 %
}

export const CCY_INFO: Record<Ccy, CcyInfo> = {
  USD: { name: { zh: '美元', ja: '米ドル' }, usdPer: 1, sigma: 0.065, peg: 0, risk: -0.15, euro: 0, region: 'america', rate: 4.25 },
  JPY: { name: { zh: '日元', ja: '円' }, usdPer: 1 / 150, sigma: 0.075, peg: 0, risk: -0.45, euro: 0, region: 'asia', rate: 0.75 },
  EUR: { name: { zh: '欧元', ja: 'ユーロ' }, usdPer: 1.08, sigma: 0.055, peg: 0, risk: 0.1, euro: 0.45, region: 'europe', rate: 2.5 },
  GBP: { name: { zh: '英镑', ja: '英ポンド' }, usdPer: 1.27, sigma: 0.07, peg: 0, risk: 0.15, euro: 0.3, region: 'europe', rate: 4.0 },
  CHF: { name: { zh: '瑞郎', ja: 'スイスフラン' }, usdPer: 1 / 0.88, sigma: 0.06, peg: 0, risk: -0.35, euro: 0.45, region: 'europe', rate: 0.5 },
  AUD: { name: { zh: '澳元', ja: '豪ドル' }, usdPer: 0.66, sigma: 0.085, peg: 0, risk: 0.5, euro: 0, region: 'oceania', rate: 3.85 },
  NZD: { name: { zh: '纽元', ja: 'NZドル' }, usdPer: 0.6, sigma: 0.09, peg: 0, risk: 0.5, euro: 0, region: 'oceania', rate: 3.5 },
  CAD: { name: { zh: '加元', ja: 'カナダドル' }, usdPer: 1 / 1.36, sigma: 0.06, peg: 0, risk: 0.3, euro: 0, region: 'america', rate: 2.75 },
  CNH: { name: { zh: '离岸人民币', ja: '人民元' }, usdPer: 1 / 7.2, sigma: 0.025, peg: 0.85, risk: 0.1, euro: 0, region: 'asia', rate: 1.5 },
  HKD: { name: { zh: '港元', ja: '香港ドル' }, usdPer: 1 / 7.8, sigma: 0.003, peg: 1, risk: 0, euro: 0, region: 'asia', rate: 4.25 },
  TWD: { name: { zh: '新台币', ja: '台湾ドル' }, usdPer: 1 / 32, sigma: 0.035, peg: 0.5, risk: 0.25, euro: 0, region: 'asia', rate: 2.0 },
  KRW: { name: { zh: '韩元', ja: '韓国ウォン' }, usdPer: 1 / 1350, sigma: 0.06, peg: 0.25, risk: 0.4, euro: 0, region: 'asia', rate: 2.5 },
  SGD: { name: { zh: '新加坡元', ja: 'シンガポールドル' }, usdPer: 1 / 1.34, sigma: 0.035, peg: 0.4, risk: 0.15, euro: 0, region: 'asia', rate: 2.5 },
};

function p(sym: string, base: Ccy, quote: Ccy, pip: number, digits: number, baseSpread: number, featured = false): PairDef {
  return { sym, base, quote, pip, digits, baseSpread, featured };
}

export const PAIRS: PairDef[] = [
  p('USDJPY', 'USD', 'JPY', 0.01, 3, 0.2, true),
  p('EURUSD', 'EUR', 'USD', 0.0001, 5, 0.3, true),
  p('EURJPY', 'EUR', 'JPY', 0.01, 3, 0.4, true),
  p('GBPJPY', 'GBP', 'JPY', 0.01, 3, 0.9, true),
  p('AUDJPY', 'AUD', 'JPY', 0.01, 3, 0.5, true),
  p('GBPUSD', 'GBP', 'USD', 0.0001, 5, 0.6),
  p('AUDUSD', 'AUD', 'USD', 0.0001, 5, 0.4),
  p('NZDUSD', 'NZD', 'USD', 0.0001, 5, 0.8),
  p('USDCAD', 'USD', 'CAD', 0.0001, 5, 0.8),
  p('USDCHF', 'USD', 'CHF', 0.0001, 5, 0.8),
  p('NZDJPY', 'NZD', 'JPY', 0.01, 3, 0.9),
  p('CADJPY', 'CAD', 'JPY', 0.01, 3, 1.2),
  p('CHFJPY', 'CHF', 'JPY', 0.01, 3, 1.4),
  p('EURGBP', 'EUR', 'GBP', 0.0001, 5, 0.6),
  p('EURAUD', 'EUR', 'AUD', 0.0001, 5, 1.0),
  p('EURCHF', 'EUR', 'CHF', 0.0001, 5, 1.0),
  p('GBPAUD', 'GBP', 'AUD', 0.0001, 5, 1.6),
  p('USDCNH', 'USD', 'CNH', 0.0001, 5, 3.0),
  p('CNHJPY', 'CNH', 'JPY', 0.001, 4, 0.6),
  p('USDHKD', 'USD', 'HKD', 0.0001, 5, 3.0),
  p('HKDJPY', 'HKD', 'JPY', 0.001, 4, 0.6),
  p('USDSGD', 'USD', 'SGD', 0.0001, 5, 2.0),
  p('USDKRW', 'USD', 'KRW', 0.1, 2, 8.0),
  p('USDTWD', 'USD', 'TWD', 0.001, 4, 15.0),
];

export const PAIR_MAP: Record<string, PairDef> = Object.fromEntries(PAIRS.map((x) => [x.sym, x]));
export const FEATURED = PAIRS.filter((x) => x.featured).map((x) => x.sym);

/** 账户本位币在行情中的对应货币 */
export function acctMarketCcy(ccy: AccountCcy): Ccy {
  return ccy === 'CNY' ? 'CNH' : 'JPY';
}

export const INITIAL_CAPITAL: Record<AccountCcy, number> = { JPY: 250_000, CNY: 12_000 };
export const LOAN_LIMIT_JPY = 10_000_000;
export const LEVERAGE_OPTIONS = [1, 25, 100, 500, 1000, 3000];

export function fmtPrice(sym: string, v: number): string {
  const d = PAIR_MAP[sym]?.digits ?? 5;
  return v.toFixed(d);
}
