// 三个 AI 角色的提示词构建与输出 → 引擎指令的转换。
// 约束：
//  - AI-1 新闻编辑只描述事件；突发事件由引擎在发布同一时刻施加有界冲击。
//  - AI-2 市场决策者只看宏观、新闻与市场概况，看不到任何玩家/AI 交易员持仓。
//  - AI-3 交易员的订单全部经过与玩家相同的 Game.order() 风控与撮合。
import type { Ccy, NewsItem, Side } from '../../shared/types';
import { CCYS, PAIR_MAP } from '../../shared/instruments';
import { atr, bollinger, ema, last, macd, rsi } from '../../shared/indicators';
import type { Game } from '../core/game';
import type { CalendarEvent } from '../../shared/types';
import { econSnapshot, SPEC, ECON_NAME, type BreakingEvent } from '../core/economy';
import { REGIME_LABEL, type MacroDirective } from '../core/market';
import { positionPnl, toAcct } from '../core/account';
import type { Breaking, MacroOut, TraderOut } from './schemas';

const LANG_NOTE = '所有文字内容必须同时给出简体中文与日文版本。只输出 JSON，不要输出任何其他文字。';

function fmtT(t: number) {
  return new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function marketBrief(g: Game) {
  const lines: string[] = [];
  for (const sym of ['USDJPY', 'EURUSD', 'EURJPY', 'GBPJPY', 'AUDJPY', 'GBPUSD', 'AUDUSD', 'USDCHF', 'USDCAD', 'USDCNH']) {
    const q = g.quotes[sym];
    const chg = ((q.bid - q.open) / q.open) * 100;
    lines.push(`${sym} ${q.bid} (日内 ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)`);
  }
  return lines.join('\n');
}

function newsBrief(news: NewsItem[], n: number) {
  return news.slice(-n).map((x) => `- [${fmtT(x.t)}] ${x.title.zh}`).join('\n') || '（暂无）';
}

// ---------------- AI-1 新闻编辑 ----------------

export function releaseArticlePrompt(g: Game, ev: CalendarEvent, local: NewsItem) {
  const system = `你是一家架空世界财经通讯社的资深新闻编辑。根据给定的经济数据公布事实撰写一条简洁的快讯。
要求：只依据给定事实，不得编造价格走势或"市场已经大涨/大跌"之类的事后解释，可以描述市场可能的解读与预期。
${LANG_NOTE}
输出格式：{"title_zh":"","title_ja":"","body_zh":"","body_ja":""}，标题 40 字以内，正文 150 字以内。`;
  const e = g.st.economy.econ[ev.ccy];
  const user = `事件：${ECON_NAME[ev.ccy].zh} ${SPEC[ev.kind].name.zh}
公布时间：${fmtT(ev.t)}
实际值：${ev.actual}${ev.unit}  市场预期：${ev.forecast}${ev.unit}  前值：${ev.previous}${ev.unit}
标准化意外值：${ev.surprise}（正数=高于预期）
重要程度：${ev.importance}/3
该经济体当前状态：政策利率 ${e.rate.toFixed(2)}%，通胀 ${e.inflation.toFixed(2)}%，失业率 ${e.unemployment.toFixed(1)}%，央行立场 ${e.stance > 0.2 ? '偏鹰' : e.stance < -0.2 ? '偏鸽' : '中性'}
参考稿：${local.title.zh} / ${local.body.zh}`;
  return { system, user };
}

export function breakingPrompt(g: Game) {
  const system = `你是架空世界财经通讯社的突发新闻编辑，负责判断此刻是否有值得发布的突发新闻（地缘政治、政策官员讲话、政治事件、大宗商品、企业/金融机构事件等，均为虚构）。
重要：你给出的新闻会被立即发布，同时引擎会根据你给出的影响方向施加有限的市场冲击，因此新闻是行情变化的“原因”。
不要发布与近期新闻重复的内容；大多数时候 (约60%) 应当 publish=false。不得针对任何交易者。
${LANG_NOTE}
输出格式：{"publish":true|false,"title_zh":"","title_ja":"","body_zh":"","body_ja":"","importance":1|2|3,"effects":[{"ccy":"USD","direction":-1到1}],"risk_sentiment":-1到1}
ccy 只能取：${CCYS.join(',')}。direction 为对该货币价值的影响方向和强度。`;
  const user = `当前时间：${fmtT(g.t)}
市场状态：${REGIME_LABEL[g.st.market.regime.kind].zh}，风险情绪 ${g.st.market.risk.toFixed(2)}
主要汇率：\n${marketBrief(g)}
近期新闻：\n${newsBrief(g.st.news, 12)}
各经济体：${JSON.stringify(econSnapshot(g.st.economy))}`;
  return { system, user };
}

/** 把 AI 提议的突发新闻转换为有界冲击 */
export function breakingToEvent(g: Game, b: Breaking): BreakingEvent | null {
  if (!b.publish || !b.title_zh || !b.title_ja) return null;
  const imp = b.importance as 1 | 2 | 3;
  const k = g.st.marketSettings.newsImpact;
  const size = [0.002, 0.005, 0.01][imp - 1];
  const shocks: BreakingEvent['shocks'] = [];
  for (const e of b.effects) {
    shocks.push({ ccy: e.ccy as Ccy, size: e.direction * size * k * g.rng.range(0.5, 1.3), immediate: 0.55, duration: 900, vol: imp * 0.4, spread: imp });
  }
  if (Math.abs(b.risk_sentiment) > 0.05) {
    shocks.push({ ccy: 'RISK', size: b.risk_sentiment * [0.003, 0.006, 0.01][imp - 1] * k * g.rng.range(0.5, 1.3), immediate: 0.5, duration: 1200, vol: imp * 0.3, spread: imp });
  }
  const ccys = [...new Set(b.effects.map((e) => e.ccy as Ccy))];
  return {
    news: {
      id: g.nextId('n'), t: g.t, kind: 'breaking', importance: imp, ccys, source: 'ai',
      title: { zh: b.title_zh, ja: b.title_ja }, body: { zh: b.body_zh, ja: b.body_ja },
    },
    shocks,
    regime: imp === 3 && b.risk_sentiment < -0.6 ? 'panic' : undefined,
  };
}

// ---------------- AI-2 市场决策者 ----------------

export function macroPrompt(g: Game) {
  const system = `你是架空外汇市场的“宏观市场状态决策者”。你根据经济指标、利率、通胀、就业、央行立场、新闻和市场情绪，
给出未来一段时间（horizon_hours）各货币的宏观倾向与波动率参数。数学行情引擎会把你的输出当作“概率倾向”而非确定结果，并叠加随机噪声。
你看不到也不应关心任何交易者的持仓。保持不确定性，避免极端值，bias 绝对值大多应小于 0.6。
只输出 JSON：{"regime":"normal|trend|range|panic|illiquid","risk_sentiment":-1到1,"horizon_hours":1到24,"currencies":{"USD":{"bias":-1到1,"volatility":0.5到3},...},"commentary":"中文简短说明"}
currencies 必须包含：${CCYS.join(',')}`;
  const cal = g.st.economy.calendar.filter((e) => !e.released && e.t < g.t + 24 * 3600 && e.importance >= 2).slice(0, 10)
    .map((e) => `${fmtT(e.t)} ${ECON_NAME[e.ccy].zh} ${SPEC[e.kind].name.zh} 预期${e.forecast}${e.unit}`).join('\n');
  const user = `当前时间：${fmtT(g.t)}
当前市场状态：${REGIME_LABEL[g.st.market.regime.kind].zh}，风险情绪 ${g.st.market.risk.toFixed(2)}
经济体数据：${JSON.stringify(econSnapshot(g.st.economy))}
主要汇率：\n${marketBrief(g)}
近期新闻：\n${newsBrief(g.st.news, 15)}
未来24小时重要日程：\n${cal || '（无）'}`;
  return { system, user };
}

export function macroToDirective(g: Game, m: MacroOut): MacroDirective {
  const ccys: MacroDirective['ccys'] = {};
  for (const c of CCYS) {
    const v = m.currencies[c];
    if (v) ccys[c] = { bias: v.bias, vol: v.volatility };
  }
  return {
    source: 'ai', t: g.t, until: g.t + m.horizon_hours * 3600, regime: m.regime, risk: m.risk_sentiment, ccys,
    commentary: m.commentary,
  };
}

// ---------------- AI-3 交易员 ----------------

function pairTech(g: Game, sym: string) {
  const tf = g.st.autoTrader.tf;
  const bars = g.candles.bars(sym, tf, 120);
  const closes = bars.map((b) => b.c);
  const p = PAIR_MAP[sym];
  const e20 = last(ema(closes, 20)), e50 = last(ema(closes, 50));
  const r = last(rsi(closes, 14));
  const m = macd(closes);
  const a = last(atr(bars, 14));
  const bb = bollinger(closes, 20, 2);
  const q = g.quotes[sym];
  const recent = bars.slice(-12).map((b) => `${b.o}/${b.h}/${b.l}/${b.c}`).join(' ');
  return {
    sym, bid: q.bid, ask: q.ask, spreadPips: q.spread,
    ema20: e20, ema50: e50, rsi14: r && Math.round(r * 10) / 10,
    macd: last(m.line), macdSignal: last(m.signal),
    atrPips: a && Math.round((a / p.pip) * 10) / 10,
    bbUpper: last(bb.up), bbLower: last(bb.dn),
    recentOHLC: recent,
  };
}

export function traderPrompt(g: Game) {
  const s = g.st.autoTrader;
  const sum = g.summary();
  const system = `你是一名外汇保证金交易员 AI，在虚拟模拟盘中独立分析并交易。所有订单会经过与人类玩家相同的风控与撮合（含点差、滑点、保证金检查、强平）。
交易风格：${s.strategy}；风险偏好：${s.risk}；单笔最多 ${s.maxLotsPerOrder} 手（1 手 = ${g.st.risk.lotUnits} 单位）；最多同时持有 ${s.maxPositions} 个 AI 持仓；
有效杠杆上限 ${s.maxEffectiveLeverage} 倍；${s.requireStopLoss ? '每笔新开仓必须设置 sl_pips。' : '止损可选。'}
可交易货币对：${s.pairs.join(', ')}。你只能平仓/修改 source=ai 的持仓。
${s.notes ? '用户补充策略说明：' + s.notes : ''}
只输出 JSON：{"analysis":"中文分析","confidence":0到1,"actions":[
 {"type":"open","sym":"USDJPY","side":"buy|sell","lots":数字,"sl_pips":数字,"tp_pips":数字,"trail_pips":数字或null,"reason":""},
 {"type":"close","position_id":"","lots":数字或null,"reason":""},
 {"type":"modify","position_id":"","sl_price":数字或null,"tp_price":数字或null,"reason":""},
 {"type":"hold","reason":""}]}`;
  const positions = g.st.positions.map((p) => ({
    id: p.id, sym: p.sym, side: p.side, lots: p.units / g.st.risk.lotUnits, open: p.openPrice, sl: p.sl, tp: p.tp,
    pnl: Math.round(positionPnl(g, p) + p.swap), source: p.source,
  }));
  const user = `时间：${fmtT(g.t)}  周期：${s.tf}
账户（${sum.ccy}）：净值 ${Math.round(sum.equity)}，余额 ${Math.round(sum.balance)}，已用保证金 ${Math.round(sum.usedMargin)}，可用保证金 ${Math.round(sum.freeMargin)}，维持率 ${sum.marginLevel ? sum.marginLevel.toFixed(0) + '%' : '无持仓'}，账户最高杠杆 ${sum.maxLeverage} 倍，有效杠杆 ${sum.effectiveLeverage.toFixed(1)} 倍，贷款债务 ${Math.round(sum.loanDebt)}
强平线：维持率 ${g.st.risk.stopOutLevel}%
持仓：${JSON.stringify(positions)}
技术面：${JSON.stringify(s.pairs.filter((x) => PAIR_MAP[x]).map((x) => pairTech(g, x)))}
近期新闻：\n${newsBrief(g.st.news, 8)}`;
  return { system, user };
}

export interface ActionResult { text: string; ok: boolean; result: string }

/** 执行交易决策（AI 或本地策略），全部经过 Game.order/close/modify */
export function executeTrader(g: Game, out: TraderOut): ActionResult[] {
  const s = g.st.autoTrader;
  const lotUnits = g.st.risk.lotUnits;
  const res: ActionResult[] = [];
  for (const a of out.actions) {
    if (a.type === 'hold') { res.push({ text: `HOLD ${a.reason}`, ok: true, result: 'hold' }); continue; }
    if (a.type === 'open') {
      const text = `OPEN ${a.sym} ${a.side} ${a.lots}lot SL${a.sl_pips ?? '-'} TP${a.tp_pips ?? '-'}`;
      const p = PAIR_MAP[a.sym];
      if (!p || !s.pairs.includes(a.sym)) { res.push({ text, ok: false, result: '不允许的货币对' }); continue; }
      if (g.st.positions.filter((x) => x.source === 'ai').length >= s.maxPositions) { res.push({ text, ok: false, result: '已达最大持仓数' }); continue; }
      if (s.requireStopLoss && !a.sl_pips) { res.push({ text, ok: false, result: '缺少止损（设置要求必须止损）' }); continue; }
      const lots = Math.min(a.lots, s.maxLotsPerOrder);
      const units = Math.max(g.st.risk.minUnits, Math.round((lots * lotUnits) / 1000) * 1000);
      const sum = g.summary();
      const addNotional = units * toAcct(g, p.base);
      if (sum.equity <= 0 || (sum.notional + addNotional) / sum.equity > s.maxEffectiveLeverage) {
        res.push({ text, ok: false, result: '超过有效杠杆上限' }); continue;
      }
      const q = g.quotes[a.sym];
      const entry = a.side === 'buy' ? q.ask : q.bid;
      const dir = a.side === 'buy' ? 1 : -1;
      const sl = a.sl_pips ? entry - dir * a.sl_pips * p.pip : null;
      const tp = a.tp_pips ? entry + dir * a.tp_pips * p.pip : null;
      const r = g.order({ sym: a.sym, side: a.side as Side, type: 'market', units, sl, tp, trailPips: a.trail_pips ?? null, source: 'ai', comment: a.reason.slice(0, 80) });
      res.push({ text, ok: r.ok, result: r.ok ? `成交 @${r.price} 滑点${r.slippagePips}p` : r.message?.zh ?? 'error' });
    } else if (a.type === 'close') {
      const text = `CLOSE ${a.position_id}${a.lots ? ' ' + a.lots + 'lot' : ''}`;
      const pos = g.st.positions.find((x) => x.id === a.position_id);
      if (!pos || pos.source !== 'ai') { res.push({ text, ok: false, result: '只能平 AI 自己的持仓' }); continue; }
      const units = a.lots ? Math.min(pos.units, Math.round((a.lots * lotUnits) / 1000) * 1000) : null;
      const r = g.close(pos.id, units && units > 0 ? units : null);
      res.push({ text, ok: r.ok, result: r.ok ? `平仓 @${r.price} 盈亏 ${Math.round(r.pnl ?? 0)}` : r.message?.zh ?? 'error' });
    } else if (a.type === 'modify') {
      const text = `MODIFY ${a.position_id} SL=${a.sl_price ?? '-'} TP=${a.tp_price ?? '-'}`;
      const pos = g.st.positions.find((x) => x.id === a.position_id);
      if (!pos || pos.source !== 'ai') { res.push({ text, ok: false, result: '只能修改 AI 自己的持仓' }); continue; }
      if (s.requireStopLoss && a.sl_price == null && pos.sl != null) { res.push({ text, ok: false, result: '不允许移除止损' }); continue; }
      const r = g.modify(pos.id, a.sl_price ?? pos.sl, a.tp_price ?? pos.tp, pos.trailPips);
      res.push({ text, ok: r.ok, result: r.ok ? '已修改' : r.message?.zh ?? 'error' });
    }
  }
  return res;
}
