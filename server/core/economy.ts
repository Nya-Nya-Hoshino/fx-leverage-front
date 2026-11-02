// 虚拟世界宏观经济：经济状态、经济日历、数据公布与突发事件。
// 因果顺序：先由经济状态 + 随机数决定数据结果 → 计算市场冲击并施加 → 同时发布新闻。
// 新闻永远描述“导致”行情的事件，而不是事后为已发生的价格走势编造理由。
import type { CalendarEvent, Ccy, I18nText, IndicatorKind, MarketSettings, NewsItem } from '../../shared/types';
import { CCY_INFO } from '../../shared/instruments';
import { Rng } from './rng';
import { isMarketOpen } from './clock';

export interface EconState {
  ccy: Ccy;
  rate: number;
  inflation: number;
  infMomentum: number;
  unemployment: number;
  gdp: number;
  pmi: number;
  sentiment: number;  // -1..1
  stance: number;     // 鹰派 + / 鸽派 -
  nfp: number;
  trade: number;
  nextRate: number;   // 下一次利率决议时间
}

export interface EconomyState {
  econ: Record<Ccy, EconState>;
  calendar: CalendarEvent[];
  generatedUntil: number;
}

export const ECON_NAME: Record<Ccy, I18nText> = {
  USD: { zh: '美国', ja: '米国' }, EUR: { zh: '欧元区', ja: 'ユーロ圏' }, JPY: { zh: '日本', ja: '日本' },
  GBP: { zh: '英国', ja: '英国' }, CHF: { zh: '瑞士', ja: 'スイス' }, AUD: { zh: '澳大利亚', ja: '豪州' },
  NZD: { zh: '新西兰', ja: 'NZ' }, CAD: { zh: '加拿大', ja: 'カナダ' }, CNH: { zh: '中国', ja: '中国' },
  HKD: { zh: '香港', ja: '香港' }, TWD: { zh: '台湾', ja: '台湾' }, KRW: { zh: '韩国', ja: '韓国' },
  SGD: { zh: '新加坡', ja: 'シンガポール' },
};

export const CB_NAME: Record<Ccy, I18nText> = {
  USD: { zh: '美联储', ja: 'FRB' }, EUR: { zh: '欧洲央行', ja: 'ECB' }, JPY: { zh: '日本央行', ja: '日銀' },
  GBP: { zh: '英国央行', ja: '英中銀' }, CHF: { zh: '瑞士央行', ja: 'SNB' }, AUD: { zh: '澳洲联储', ja: 'RBA' },
  NZD: { zh: '新西兰联储', ja: 'RBNZ' }, CAD: { zh: '加拿大央行', ja: 'カナダ中銀' }, CNH: { zh: '中国人民银行', ja: '人民銀行' },
  HKD: { zh: '香港金管局', ja: 'HKMA' }, TWD: { zh: '台湾央行', ja: '台湾中銀' }, KRW: { zh: '韩国央行', ja: '韓国銀行' },
  SGD: { zh: '新加坡金管局', ja: 'MAS' },
};

interface Spec { name: I18nText; unit: string; sd: number; dir: 1 | -1; dp: number }
export const SPEC: Record<IndicatorKind, Spec> = {
  CPI: { name: { zh: '消费者物价指数(CPI) 同比', ja: '消費者物価指数(CPI) 前年比' }, unit: '%', sd: 0.15, dir: 1, dp: 1 },
  NFP: { name: { zh: '非农就业人数', ja: '非農業部門雇用者数' }, unit: 'K', sd: 55, dir: 1, dp: 0 },
  UNEMP: { name: { zh: '失业率', ja: '失業率' }, unit: '%', sd: 0.12, dir: -1, dp: 1 },
  GDP: { name: { zh: 'GDP 季环比年化', ja: 'GDP 前期比年率' }, unit: '%', sd: 0.45, dir: 1, dp: 1 },
  PMI: { name: { zh: '制造业PMI', ja: '製造業PMI' }, unit: '', sd: 1.2, dir: 1, dp: 1 },
  RETAIL: { name: { zh: '零售销售 月率', ja: '小売売上高 前月比' }, unit: '%', sd: 0.4, dir: 1, dp: 1 },
  RATE: { name: { zh: '政策利率决议', ja: '政策金利発表' }, unit: '%', sd: 0.25, dir: 1, dp: 2 },
  TRADE: { name: { zh: '贸易收支', ja: '貿易収支' }, unit: 'bn', sd: 4, dir: 1, dp: 1 },
  SENTI: { name: { zh: '消费者信心指数', ja: '消費者信頼感指数' }, unit: '', sd: 2.5, dir: 1, dp: 1 },
};

const MAJORS: Ccy[] = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'NZD', 'CAD', 'CHF'];
const DATA_HOUR: Record<Ccy, number> = {
  USD: 13.5, EUR: 10, JPY: 23.83, GBP: 7, AUD: 0.5, NZD: 22.75, CAD: 13.5, CHF: 7.5, CNH: 1.5, HKD: 8.5, TWD: 8, KRW: 23, SGD: 5,
};
const RATE_HOUR: Record<Ccy, number> = {
  USD: 19, EUR: 12.25, JPY: 3, GBP: 12, AUD: 3.5, NZD: 1, CAD: 14.75, CHF: 8.5, CNH: 1.25, HKD: 19.5, TWD: 8.5, KRW: 1, SGD: 1,
};
const DAILY_PROB: Partial<Record<Ccy, number>> = { USD: 0.85, EUR: 0.6, JPY: 0.55, GBP: 0.5, AUD: 0.5, NZD: 0.35, CAD: 0.4, CHF: 0.3, CNH: 0.35 };
const INFL_TARGET = 2;

function kindsFor(c: Ccy): IndicatorKind[] {
  if (c === 'USD') return ['CPI', 'NFP', 'UNEMP', 'GDP', 'PMI', 'RETAIL', 'SENTI'];
  if (MAJORS.includes(c)) return ['CPI', 'UNEMP', 'GDP', 'PMI', 'RETAIL', 'SENTI'];
  if (c === 'CNH') return ['CPI', 'GDP', 'PMI', 'TRADE'];
  return ['CPI', 'TRADE'];
}

function importanceOf(c: Ccy, k: IndicatorKind): 1 | 2 | 3 {
  if (k === 'RATE') return MAJORS.includes(c) ? 3 : 2;
  if (k === 'NFP') return 3;
  if (k === 'CPI' && ['USD', 'EUR', 'JPY', 'GBP'].includes(c)) return 3;
  if (!MAJORS.includes(c) && c !== 'CNH') return 1;
  if (k === 'SENTI' || k === 'TRADE') return 1;
  return 2;
}

export function initEconomy(rng: Rng, t: number): EconomyState {
  const econ = {} as Record<Ccy, EconState>;
  for (const c of Object.keys(CCY_INFO) as Ccy[]) {
    const info = CCY_INFO[c];
    econ[c] = {
      ccy: c,
      rate: info.rate,
      inflation: Math.max(-0.5, info.rate * 0.4 + 1 + rng.normal() * 0.4),
      infMomentum: rng.normal() * 0.03,
      unemployment: c === 'JPY' ? 2.5 : c === 'EUR' ? 6.3 : 4 + rng.normal() * 0.4,
      gdp: 1.5 + rng.normal() * 0.8,
      pmi: 50 + rng.normal() * 1.5,
      sentiment: rng.normal() * 0.3,
      stance: rng.normal() * 0.4,
      nfp: 160 + rng.normal() * 40,
      trade: rng.normal() * 8,
      nextRate: t + rng.range(3, 20) * 86400,
    };
  }
  return { econ, calendar: [], generatedUntil: Math.floor(t / 86400) * 86400 };
}

function round(v: number, dp: number) {
  const m = 10 ** dp;
  return Math.round(v * m) / m;
}

function expectedRateChange(e: EconState): number {
  const gap = e.inflation - INFL_TARGET;
  const score = gap * 0.8 + e.stance * 0.6 - (e.unemployment - 4.5) * 0.3 + e.gdp * 0.1 - 0.15;
  if (score > 0.7) return 0.25;
  if (score < -0.7 && e.rate > 0) return -0.25;
  return 0;
}

function forecastFor(e: EconState, k: IndicatorKind, rng: Rng): { forecast: number; previous: number } {
  const s = SPEC[k];
  switch (k) {
    case 'CPI': return { previous: round(e.inflation, 1), forecast: round(e.inflation + e.infMomentum * 3 + rng.normal() * 0.05, 1) };
    case 'NFP': return { previous: round(e.nfp, 0), forecast: round(e.nfp * 0.8 + 30 + e.sentiment * 30, 0) };
    case 'UNEMP': return { previous: round(e.unemployment, 1), forecast: round(e.unemployment + rng.normal() * 0.05, 1) };
    case 'GDP': return { previous: round(e.gdp, 1), forecast: round(e.gdp * 0.7 + 0.5 + e.sentiment * 0.4, 1) };
    case 'PMI': return { previous: round(e.pmi, 1), forecast: round(e.pmi * 0.8 + 10 + e.sentiment, 1) };
    case 'RETAIL': return { previous: round(0.3 + e.sentiment * 0.5 + rng.normal() * 0.3, 1), forecast: round(0.3 + e.sentiment * 0.5, 1) };
    case 'RATE': return { previous: round(e.rate, 2), forecast: round(e.rate + expectedRateChange(e), 2) };
    case 'TRADE': return { previous: round(e.trade, 1), forecast: round(e.trade * 0.9, 1) };
    case 'SENTI': return { previous: round(100 + e.sentiment * 10, 1), forecast: round(100 + e.sentiment * 10 + rng.normal() * s.sd * 0.2, 1) };
  }
}

/** 确保日历覆盖未来 3 天 */
export function ensureCalendar(es: EconomyState, t: number, rng: Rng, nextId: (p: string) => string) {
  while (es.generatedUntil < t + 3 * 86400) {
    const day = es.generatedUntil;
    es.generatedUntil += 86400;
    for (const c of Object.keys(es.econ) as Ccy[]) {
      const e = es.econ[c];
      const p = DAILY_PROB[c] ?? 0.15;
      const evs: { kind: IndicatorKind; at: number }[] = [];
      if (rng.chance(p)) {
        let kind = rng.pick(kindsFor(c));
        if (c === 'USD' && new Date(day * 1000).getUTCDay() === 5 && rng.chance(0.6)) kind = 'NFP';
        const at = day + DATA_HOUR[c] * 3600 + rng.pick([0, 0, 900, 1800]);
        evs.push({ kind, at: Math.round(at) });
      }
      if (e.nextRate >= day && e.nextRate < day + 86400) {
        evs.push({ kind: 'RATE', at: Math.round(day + RATE_HOUR[c] * 3600) });
        e.nextRate = day + rng.range(14, 28) * 86400;
      }
      for (const ev of evs) {
        if (!isMarketOpen(ev.at) || ev.at <= t) {
          if (ev.kind === 'RATE') e.nextRate = day + 86400 * rng.range(1, 3);
          continue;
        }
        const { forecast, previous } = forecastFor(e, ev.kind, rng);
        es.calendar.push({
          id: nextId('ev'), t: ev.at, ccy: c, kind: ev.kind, importance: importanceOf(c, ev.kind),
          forecast, previous, actual: null, unit: SPEC[ev.kind].unit, surprise: null, released: false,
        });
      }
    }
    es.calendar.sort((a, b) => a.t - b.t);
  }
  // 保留最近 4 天的已公布事件
  es.calendar = es.calendar.filter((x) => !x.released || x.t > t - 4 * 86400);
}

/** 经济状态的日常缓慢演化 */
export function driftEconomy(es: EconomyState, dt: number, rng: Rng) {
  const k = Math.sqrt(dt / 86400);
  for (const e of Object.values(es.econ)) {
    e.infMomentum += -e.infMomentum * Math.min(1, dt / (20 * 86400)) + rng.normal() * 0.01 * k;
    e.inflation += e.infMomentum * dt / 86400 * 0.2 + rng.normal() * 0.01 * k;
    e.sentiment += -e.sentiment * Math.min(1, dt / (15 * 86400)) + rng.normal() * 0.05 * k;
    e.sentiment = Math.max(-1, Math.min(1, e.sentiment));
    e.stance += (Math.tanh(e.inflation - INFL_TARGET) * 0.6 - e.stance) * Math.min(1, dt / (30 * 86400)) + rng.normal() * 0.02 * k;
  }
}

export interface ReleaseResult {
  event: CalendarEvent;
  shock: number;          // 对该货币的对数冲击
  news: NewsItem;
}

const IMPACT: Record<1 | 2 | 3, number> = { 1: 0.0005, 2: 0.0012, 3: 0.0025 };

function fmt(v: number, k: IndicatorKind) {
  const s = SPEC[k];
  const sign = (k === 'RETAIL' || k === 'GDP' || k === 'TRADE') && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(s.dp)}${s.unit}`;
}

/** 公布数据：生成实际值 → 计算冲击 → 更新经济状态 → 生成新闻 */
export function releaseEvent(es: EconomyState, ev: CalendarEvent, rng: Rng, s: MarketSettings, nextId: (p: string) => string): ReleaseResult {
  const e = es.econ[ev.ccy];
  const spec = SPEC[ev.kind];
  let actual: number;
  if (ev.kind === 'RATE') {
    const r = rng.next();
    actual = r < 0.72 ? ev.forecast : r < 0.86 ? ev.forecast + 0.25 : Math.max(-0.5, ev.forecast - 0.25);
  } else {
    let hidden = 0;
    if (ev.kind === 'CPI') hidden = e.infMomentum * 2;
    if (ev.kind === 'NFP' || ev.kind === 'PMI' || ev.kind === 'RETAIL' || ev.kind === 'SENTI') hidden = e.sentiment * spec.sd * 0.5;
    if (ev.kind === 'UNEMP') hidden = -e.sentiment * spec.sd * 0.4;
    actual = ev.forecast + hidden + rng.normal() * spec.sd;
  }
  actual = round(actual, spec.dp);
  const z = ev.kind === 'RATE' ? ((actual - ev.forecast) / 0.25) * 1.6 : (actual - ev.forecast) / spec.sd;
  ev.actual = actual;
  ev.surprise = Math.round(z * 100) / 100;
  ev.released = true;

  // 更新经济状态
  switch (ev.kind) {
    case 'CPI': e.inflation = actual; break;
    case 'NFP': e.nfp = actual; e.sentiment += z * 0.05; break;
    case 'UNEMP': e.unemployment = actual; break;
    case 'GDP': e.gdp = actual; e.sentiment += z * 0.04; break;
    case 'PMI': e.pmi = actual; e.sentiment += z * 0.03; break;
    case 'RATE': e.rate = actual; e.stance += (actual - ev.previous) * 2; break;
    case 'TRADE': e.trade = actual; break;
    case 'SENTI': e.sentiment += z * 0.03; break;
  }
  e.sentiment = Math.max(-1, Math.min(1, e.sentiment));

  // 市场反应：方向由意外值决定，但强度随机，并有“利好出尽”式反向反应
  const zc = Math.max(-4, Math.min(4, z));
  let shock = zc * spec.dir * IMPACT[ev.importance] * s.newsImpact * rng.range(0.5, 1.5);
  if (rng.chance(0.1)) shock *= -0.5;

  const news = releaseNews(ev, z, nextId);
  return { event: ev, shock, news };
}

function releaseNews(ev: CalendarEvent, z: number, nextId: (p: string) => string): NewsItem {
  const en = ECON_NAME[ev.ccy];
  const sp = SPEC[ev.kind];
  const cb = CB_NAME[ev.ccy];
  const cn = CCY_INFO[ev.ccy].name;
  const a = fmt(ev.actual!, ev.kind), f = fmt(ev.forecast, ev.kind), p = fmt(ev.previous, ev.kind);
  let title: I18nText, body: I18nText;
  if (ev.kind === 'RATE') {
    const diff = ev.actual! - ev.previous;
    const act = diff > 0 ? { zh: `加息至 ${a}`, ja: `${a}へ利上げ` } : diff < 0 ? { zh: `降息至 ${a}`, ja: `${a}へ利下げ` } : { zh: `维持利率 ${a} 不变`, ja: `政策金利を${a}に据え置き` };
    title = { zh: `【${cb.zh}】${act.zh}（市场预期 ${f}）`, ja: `【${cb.ja}】${act.ja}（市場予想 ${f}）` };
    const surpriseTxt = Math.abs(z) < 0.1
      ? { zh: '决议符合市场预期，焦点转向声明措辞与后续指引。', ja: '決定は市場予想通りで、焦点は声明文と先行きのガイダンスに移る。' }
      : z > 0
        ? { zh: `决议比市场预期更偏鹰派，${cn.zh}的利差优势被重新评估。`, ja: `決定は予想よりタカ派的で、${cn.ja}の金利差優位が再評価される。` }
        : { zh: `决议比市场预期更偏鸽派，市场开始重新定价${cn.zh}的利率路径。`, ja: `決定は予想よりハト派的で、${cn.ja}の金利見通しの織り込み直しが始まる。` };
    body = {
      zh: `${cb.zh}公布政策利率决议：${act.zh}，此前利率为 ${p}。${surpriseTxt.zh}`,
      ja: `${cb.ja}は政策金利を発表：${act.ja}。従来は${p}。${surpriseTxt.ja}`,
    };
  } else {
    title = { zh: `【${en.zh}】${sp.name.zh} ${a}（预期 ${f} / 前值 ${p}）`, ja: `【${en.ja}】${sp.name.ja} ${a}（予想 ${f} / 前回 ${p}）` };
    const good = z * sp.dir;
    const tone = Math.abs(z) < 0.5
      ? { zh: '数据大致符合预期，对市场的直接影响有限。', ja: '結果はおおむね予想通りで、市場への直接的な影響は限定的。' }
      : good > 1.5
        ? { zh: `数据大幅好于预期，市场对${cb.zh}收紧政策的猜测升温，${cn.zh}获得支撑。`, ja: `結果は予想を大きく上回り、${cb.ja}の引き締め観測が強まり${cn.ja}の支援材料に。` }
        : good > 0
          ? { zh: `数据好于预期，对${cn.zh}构成温和利好。`, ja: `結果は予想を上回り、${cn.ja}にとって緩やかな好材料。` }
          : good < -1.5
            ? { zh: `数据大幅逊于预期，${cb.zh}放松政策的可能性受到关注，${cn.zh}承压。`, ja: `結果は予想を大きく下回り、${cb.ja}の緩和観測が意識され${cn.ja}の重しに。` }
            : { zh: `数据逊于预期，对${cn.zh}略为不利。`, ja: `結果は予想を下回り、${cn.ja}にはやや弱材料。` };
    body = { zh: `${en.zh}公布${sp.name.zh}：${a}，市场预期 ${f}，前值 ${p}。${tone.zh}`, ja: `${en.ja}の${sp.name.ja}は${a}。市場予想は${f}、前回は${p}。${tone.ja}` };
  }
  return { id: nextId('n'), t: ev.t, kind: 'release', title, body, ccys: [ev.ccy], importance: ev.importance, eventId: ev.id, source: 'local' };
}

export function previewNews(ev: CalendarEvent, t: number, nextId: (p: string) => string): NewsItem {
  const en = ECON_NAME[ev.ccy];
  const sp = SPEC[ev.kind];
  const cn = CCY_INFO[ev.ccy].name;
  const f = fmt(ev.forecast, ev.kind), p = fmt(ev.previous, ev.kind);
  const mins = Math.max(1, Math.round((ev.t - t) / 60));
  const dirTxt = ev.forecast === ev.previous
    ? { zh: '预期与前值持平', ja: '前回と同水準の予想' }
    : (ev.forecast - ev.previous) * sp.dir > 0 ? { zh: '预期较前值改善', ja: '前回から改善の予想' } : { zh: '预期较前值恶化', ja: '前回から悪化の予想' };
  const exp: I18nText = {
    zh: `市场预期 ${f}（前值 ${p}），${dirTxt.zh}。结果若显著偏离预期，${cn.zh}相关货币对可能剧烈波动，点差或将扩大。`,
    ja: `市場予想は${f}（前回${p}）で${dirTxt.ja}。予想から大きく乖離すれば${cn.ja}絡みの通貨ペアが急変動し、スプレッド拡大の可能性。`,
  };
  return {
    id: nextId('n'), t, kind: 'preview',
    title: { zh: `【前瞻】${mins}分钟后 ${en.zh}${sp.name.zh}`, ja: `【予告】${mins}分後に${en.ja}${sp.name.ja}` },
    body: exp, expectation: exp, ccys: [ev.ccy], importance: ev.importance, eventId: ev.id, source: 'local',
  };
}

/** 突发事件（本地生成器）。返回需要施加的冲击和同时发布的新闻 */
export interface BreakingEvent {
  news: NewsItem;
  shocks: { ccy: Ccy | 'RISK'; size: number; immediate: number; duration: number; vol: number; spread: number }[];
  regime?: 'panic' | 'flash' | 'illiquid';
}

export function maybeBreaking(t: number, dt: number, rng: Rng, s: MarketSettings, usdjpy: number, nextId: (p: string) => string): BreakingEvent | null {
  const hourly = 0.035 * s.jumpRate;
  const pBlack = s.blackSwanPerYear * dt / (365 * 86400);
  if (rng.chance(pBlack)) return blackSwan(t, rng, s, nextId);
  // 为汇率干预单独计算：美日高于 158 后干预概率上升
  if (usdjpy > 158 && rng.chance(0.02 * (usdjpy - 158) * dt / 3600)) return intervention(t, rng, s, nextId);
  if (!rng.chance(hourly * dt / 3600)) return null;
  const k = rng.pick(['riskoff', 'riskon', 'cbtalk', 'commodity', 'politics'] as const);
  const imp = s.newsImpact;
  const mk = (title: I18nText, body: I18nText, ccys: Ccy[], importance: 1 | 2 | 3): NewsItem =>
    ({ id: nextId('n'), t, kind: 'breaking', title, body, ccys, importance, source: 'local' });
  switch (k) {
    case 'riskoff': {
      const size = -rng.range(0.004, 0.012) * imp;
      return {
        news: mk({ zh: '【突发】地缘政治紧张局势骤然升级，避险情绪急升', ja: '【速報】地政学リスクが急激に高まり、リスク回避ムード強まる' },
          { zh: '多家媒体报道某地区军事对峙升级。资金流向日元、瑞郎等避险货币，高息货币遭抛售。', ja: '複数メディアがある地域での軍事的緊張の高まりを報道。資金は円・スイスフランなど安全通貨へ流れ、高金利通貨は売られやすい。' },
          ['JPY', 'CHF', 'AUD', 'NZD'], 3),
        shocks: [{ ccy: 'RISK', size, immediate: 0.5, duration: 1200, vol: 1.2, spread: 3 }],
        regime: rng.chance(0.4) ? 'panic' : undefined,
      };
    }
    case 'riskon': {
      const size = rng.range(0.003, 0.008) * imp;
      return {
        news: mk({ zh: '【快讯】主要经济体达成贸易协议框架，风险偏好回升', ja: '【速報】主要国が貿易協定の枠組みで合意、リスク選好が回復' },
          { zh: '谈判取得进展的消息提振市场信心，资源国货币与高息货币获得买盘。', ja: '交渉進展の報道で市場心理が改善し、資源国通貨・高金利通貨に買いが入る。' },
          ['AUD', 'NZD', 'JPY'], 2),
        shocks: [{ ccy: 'RISK', size, immediate: 0.5, duration: 1800, vol: 0.5, spread: 1 }],
      };
    }
    case 'cbtalk': {
      const c = rng.pick(['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD'] as Ccy[]);
      const dir = rng.sign();
      const cb = CB_NAME[c];
      const size = dir * rng.range(0.002, 0.005) * imp;
      const hawk = dir > 0;
      return {
        news: mk({ zh: `【快讯】${cb.zh}高层官员发表${hawk ? '鹰派' : '鸽派'}言论`, ja: `【速報】${cb.ja}高官が${hawk ? 'タカ派' : 'ハト派'}発言` },
          { zh: `${cb.zh}一位高层官员表示${hawk ? '通胀风险仍需警惕，不排除进一步收紧' : '经济下行风险上升，有必要保持宽松'}。市场正在重新评估政策路径。`, ja: `${cb.ja}高官は「${hawk ? 'インフレリスクに警戒が必要で、追加引き締めも排除しない' : '景気下振れリスクが高まっており、緩和的な姿勢の維持が必要'}」と発言。市場は政策見通しを再評価。` },
          [c], 2),
        shocks: [{ ccy: c, size, immediate: 0.6, duration: 600, vol: 0.6, spread: 1.5 }],
      };
    }
    case 'commodity': {
      const dir = rng.sign();
      const size = dir * rng.range(0.003, 0.007) * imp;
      return {
        news: mk({ zh: dir > 0 ? '【快讯】大宗商品价格急涨，资源国货币走俏' : '【快讯】大宗商品价格暴跌，资源国货币承压', ja: dir > 0 ? '【速報】商品市況が急騰、資源国通貨に買い' : '【速報】商品市況が急落、資源国通貨に売り圧力' },
          { zh: '铁矿石与原油期货出现大幅波动，市场关注澳元、加元、纽元的贸易条件变化。', ja: '鉄鉱石・原油先物が大きく変動し、豪ドル・カナダドル・NZドルの交易条件の変化に注目が集まる。' },
          ['AUD', 'CAD', 'NZD'], 2),
        shocks: [
          { ccy: 'AUD', size, immediate: 0.5, duration: 900, vol: 0.6, spread: 1.5 },
          { ccy: 'CAD', size: size * 0.7, immediate: 0.5, duration: 900, vol: 0.5, spread: 1 },
          { ccy: 'NZD', size: size * 0.8, immediate: 0.5, duration: 900, vol: 0.5, spread: 1 },
        ],
      };
    }
    case 'politics': {
      const c = rng.pick(['EUR', 'GBP'] as Ccy[]);
      const size = -rng.range(0.003, 0.009) * imp;
      const en = ECON_NAME[c];
      return {
        news: mk({ zh: `【突发】${en.zh}政局动荡，执政联盟面临瓦解`, ja: `【速報】${en.ja}で政局混乱、連立政権崩壊の危機` },
          { zh: `${en.zh}主要执政党之间的分歧公开化，财政前景不确定性上升，${CCY_INFO[c].name.zh}遭遇抛售压力。`, ja: `${en.ja}の与党間の対立が表面化し、財政見通しの不透明感から${CCY_INFO[c].name.ja}に売り圧力。` },
          [c], 2),
        shocks: [{ ccy: c, size, immediate: 0.55, duration: 1200, vol: 0.9, spread: 2 }],
      };
    }
  }
}

export function intervention(t: number, rng: Rng, s: MarketSettings, nextId: (p: string) => string): BreakingEvent {
  const size = rng.range(0.025, 0.045) * s.newsImpact;
  return {
    news: {
      id: nextId('n'), t, kind: 'breaking', importance: 3, ccys: ['JPY', 'USD'], source: 'local',
      title: { zh: '【突发】日本政府·日本央行疑似入市干预汇率！日元急升', ja: '【速報】政府・日銀が為替介入か！円が急騰' },
      body: { zh: '在日元持续贬值之际，市场出现大额日元买单，交易员普遍认为当局实施了买日元干预。美日短时间内暴跌数百点，点差急剧扩大。', ja: '円安が続く中、大口の円買いが観測され、市場では当局による円買い介入との見方が広がる。ドル円は短時間で数円急落し、スプレッドが急拡大。' },
    },
    shocks: [{ ccy: 'JPY', size, immediate: 0.7, duration: 600, vol: 2, spread: 8 }],
    regime: 'illiquid',
  };
}

function blackSwan(t: number, rng: Rng, s: MarketSettings, nextId: (p: string) => string): BreakingEvent {
  const c = rng.pick(['GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'EUR', 'USD'] as Ccy[]);
  const dir = c === 'JPY' || c === 'CHF' ? rng.chance(0.7) ? 1 : -1 : rng.chance(0.8) ? -1 : 1;
  const size = dir * rng.range(0.02, 0.06);
  const cn = CCY_INFO[c].name;
  return {
    news: {
      id: nextId('n'), t, kind: 'breaking', importance: 3, ccys: [c], source: 'local',
      title: { zh: `【黑天鹅】${cn.zh}闪崩！流动性瞬间蒸发`, ja: `【ブラックスワン】${cn.ja}がフラッシュクラッシュ！流動性が瞬時に消失` },
      body: { zh: `${cn.zh}在数分钟内剧烈${dir > 0 ? '飙升' : '暴跌'}，算法交易连锁触发止损，多家平台报价中断、点差扩大数十倍。`, ja: `${cn.ja}が数分で${dir > 0 ? '急騰' : '暴落'}。アルゴ取引が連鎖的にストップを巻き込み、複数の業者で配信停止・スプレッドが数十倍に拡大。` },
    },
    shocks: [
      { ccy: c, size, immediate: 0.8, duration: 180, vol: 3, spread: 25 },
      { ccy: c, size: -size * 0.4, immediate: 0, duration: 1500, vol: 0, spread: 0 },
    ],
    regime: 'flash',
  };
}

export function econSnapshot(es: EconomyState) {
  return Object.values(es.econ).map((e) => ({
    ccy: e.ccy, rate: round(e.rate, 2), inflation: round(e.inflation, 2), unemployment: round(e.unemployment, 2),
    gdp: round(e.gdp, 2), pmi: round(e.pmi, 1), sentiment: round(e.sentiment, 2), stance: round(e.stance, 2),
  }));
}
