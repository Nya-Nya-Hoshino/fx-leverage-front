// 游戏主循环：把行情、经济、撮合、风控、借贷串联在同一个模拟时钟上。
// 每个子步中：事件 → 价格演化 → 报价 → K线 → 掉期/利息 → 挂单与止盈止损 → 风控。
import type {
  AccountCcy, AccountSummary, AiLogEntry, Ccy, I18nText, MarketMode, NewsItem, Notice, Quote, TradeRecord,
} from '../../shared/types';
import { PAIRS, INITIAL_CAPITAL } from '../../shared/instruments';
import { Rng } from './rng';
import { CandleStore } from './candles';
import { START_T, isMarketOpen, nextClose, nextOpen, rolloversBetween } from './clock';
import {
  applyMacro, applyShock, applyWeekendGap, initMarket, localMacro, makeQuotes, REGIME_LABEL, setRegime, stepMarket,
  updateRegime, usdPer, type MacroDirective,
} from './market';
import {
  driftEconomy, ensureCalendar, initEconomy, maybeBreaking, previewNews, releaseEvent, type BreakingEvent, type ReleaseResult,
} from './economy';
import { applyRollover, positionMargin, summarize } from './account';
import {
  cancelOrder, closePosition, modifyPosition, placeOrder, processTriggers, type ExecCtx, type ExecResult, type OrderRequest,
} from './execution';
import { checkRisk, handleNegative } from './risk';
import { accrueLoans, borrow, repay, type LoanResult } from './loans';
import {
  DEFAULT_AUTOTRADER, DEFAULT_MARKET_SETTINGS, DEFAULT_RISK, defaultRoles, emptyUsage, type GameState,
} from './state';

export interface NewGameOptions {
  saveId: string;
  name: string;
  username: string;
  accountCcy: AccountCcy;
  maxLeverage: number;
  seed?: number;
  marketMode?: MarketMode;
  preRollDays?: number;
}

export interface Outbox {
  notices: Notice[];
  news: NewsItem[];
  aiLog: AiLogEntry[];
  trades: TradeRecord[];
  releases: ReleaseResult[];
  majorEvent: boolean;
}

const CAP = { notices: 300, news: 400, trades: 3000, aiLog: 600, curve: 3000 };

export class Game implements ExecCtx {
  st: GameState;
  rng: Rng;
  rngExec: Rng;
  candles: CandleStore;
  quotes: Record<string, Quote> = {};
  up: Record<Ccy, number> = {} as Record<Ccy, number>;
  outbox: Outbox = Game.emptyOutbox();
  quiet = false;

  static emptyOutbox(): Outbox {
    return { notices: [], news: [], aiLog: [], trades: [], releases: [], majorEvent: false };
  }

  private constructor(st: GameState) {
    this.st = st;
    this.rng = new Rng(st.rng);
    this.rngExec = new Rng(st.rngExec);
    this.candles = new CandleStore(PAIRS.map((p) => p.sym));
  }

  get t() {
    return this.st.clock.t;
  }

  static create(o: NewGameOptions): Game {
    const seed = (o.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
    const rng = Rng.fromSeed(seed);
    const rngExec = Rng.fromSeed(seed ^ 0x5bd1e995);
    const preRoll = (o.preRollDays ?? 7) * 86400;
    const t0 = START_T - preRoll;
    const capital = INITIAL_CAPITAL[o.accountCcy];
    const st: GameState = {
      version: 1,
      saveId: o.saveId,
      name: o.name,
      createdAt: Date.now(),
      seed,
      rng: [],
      rngExec: [],
      clock: { t: t0, speed: 1, paused: false, tickMs: 4000, autoSkipWeekend: true },
      closedSince: null,
      market: initMarket(rng, t0, o.marketMode ?? 'random'),
      marketSettings: { ...DEFAULT_MARKET_SETTINGS },
      risk: { ...DEFAULT_RISK },
      economy: initEconomy(rng, t0),
      account: {
        username: o.username, ccy: o.accountCcy, maxLeverage: o.maxLeverage, balance: capital, realized: 0, totalSwap: 0,
        initialCapital: capital, marginCallActive: false,
      },
      positions: [], orders: [], trades: [], loans: [], news: [], notices: [], aiLog: [], equityCurve: [], lastCurveT: 0,
      stats: {
        peakEquity: capital, maxDrawdownPct: 0, trades: 0, wins: 0, losses: 0, stopOuts: 0, marginCalls: 0,
        biggestWin: 0, biggestLoss: 0, maxLoanPrincipal: 0, totalInterestPaid: 0, totalBorrowed: 0,
      },
      ai: {
        roles: defaultRoles(),
        acc: { news: 0, macro: 0, trader: 0 },
        usage: { news: emptyUsage(), macro: emptyUsage(), trader: emptyUsage() },
      },
      autoTrader: { ...DEFAULT_AUTOTRADER, pairs: [...DEFAULT_AUTOTRADER.pairs] },
      seq: { id: 0, notice: 0 },
      forming: {},
      gameOver: null,
    };
    st.rng = rng.getState();
    st.rngExec = rngExec.getState();
    const g = new Game(st);
    g.refreshQuotes();
    // 预先生成历史行情，使图表一开始就有数据
    g.quiet = true;
    st.clock.autoSkipWeekend = false; // 让周末也消耗预生成时长，使游戏正好从 START_T 开始
    g.simulate(START_T - t0, 15);
    st.clock.autoSkipWeekend = true;
    g.quiet = false;
    st.notices = [];
    g.outbox = Game.emptyOutbox();
    st.equityCurve = [];
    g.recordCurve(true);
    g.notify('info', 'welcome', {
      zh: `欢迎，${o.username}！模拟账户已开立：${capital.toLocaleString()} ${o.accountCcy}，最高杠杆 ${o.maxLeverage} 倍。`,
      ja: `ようこそ、${o.username}さん！デモ口座開設：${capital.toLocaleString()} ${o.accountCcy}、最大レバレッジ ${o.maxLeverage} 倍。`,
    });
    return g;
  }

  static restore(st: GameState, closed: { sym: string; tf: any; c: any }[]): Game {
    const g = new Game(st);
    g.candles.restore(closed, st.forming ?? {});
    g.refreshQuotes();
    return g;
  }

  serialize(): GameState {
    this.st.rng = this.rng.getState();
    this.st.rngExec = this.rngExec.getState();
    this.st.forming = this.candles.formingSnapshot();
    return this.st;
  }

  // ---------- ExecCtx ----------
  nextId(prefix: string) {
    return `${prefix}${++this.st.seq.id}`;
  }

  notify(level: Notice['level'], code: string, text: I18nText, big = false) {
    if (this.quiet) return;
    const n: Notice = { seq: ++this.st.seq.notice, t: this.t, level, code, text, big };
    this.st.notices.push(n);
    if (this.st.notices.length > CAP.notices) this.st.notices.splice(0, this.st.notices.length - CAP.notices);
    this.outbox.notices.push(n);
  }

  recordTrade(r: Omit<TradeRecord, 'id' | 't' | 'balanceAfter'>): TradeRecord {
    const rec: TradeRecord = { ...r, id: this.nextId('tr'), t: this.t, balanceAfter: this.st.account.balance };
    this.st.trades.push(rec);
    if (this.st.trades.length > CAP.trades) this.st.trades.splice(0, this.st.trades.length - CAP.trades);
    this.outbox.trades.push(rec);
    return rec;
  }

  marketOpen() {
    return !this.st.market.closed && isMarketOpen(this.t);
  }

  // ---------- 行情 ----------
  refreshQuotes() {
    this.up = usdPer(this.st.market);
    this.quotes = makeQuotes(this.st.market, this.t, this.st.marketSettings, Object.keys(this.quotes).length ? this.quotes : null);
  }

  pushNews(n: NewsItem) {
    this.st.news.push(n);
    if (this.st.news.length > CAP.news) this.st.news.splice(0, this.st.news.length - CAP.news);
    this.outbox.news.push(n);
  }

  /** 用 AI 撰写的正文替换同一条新闻（时间与冲击不变） */
  updateNews(id: string, patch: Partial<NewsItem>) {
    const n = this.st.news.find((x) => x.id === id);
    if (!n) return;
    Object.assign(n, patch);
    this.outbox.news.push(n);
  }

  pushAiLog(e: AiLogEntry) {
    this.st.aiLog.push(e);
    if (this.st.aiLog.length > CAP.aiLog) this.st.aiLog.splice(0, this.st.aiLog.length - CAP.aiLog);
    this.outbox.aiLog.push(e);
  }

  /** 实时推进：realDt 为真实秒数 */
  advance(realDt: number) {
    const c = this.st.clock;
    if (c.paused || this.st.gameOver) return;
    const dtSim = realDt * c.speed;
    this.simulate(dtSim, Math.max(4, dtSim / 600));
  }

  simulate(dtSim: number, subMax: number) {
    const c = this.st.clock;
    let remaining = dtSim;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 200000) {
      const t = c.t;
      if (!isMarketOpen(t)) {
        if (!this.st.market.closed) this.onClose();
        const open = nextOpen(t);
        if (c.autoSkipWeekend) {
          this.passTime(open - t);
          this.onReopen();
          continue;
        }
        const step = Math.min(remaining, open - t);
        this.passTime(step);
        remaining -= step;
        if (c.t >= open) this.onReopen();
        continue;
      }
      if (this.st.market.closed) this.onReopen();
      const toClose = nextClose(t) - t;
      const dt = Math.min(remaining, subMax, toClose);
      this.substep(dt);
      remaining -= dt;
      if (this.st.gameOver) break;
    }
    this.afterAdvance();
  }

  /** 手动跳过周末 */
  skipWeekend() {
    if (isMarketOpen(this.t)) return false;
    if (!this.st.market.closed) this.onClose();
    this.passTime(nextOpen(this.t) - this.t);
    this.onReopen();
    this.afterAdvance();
    return true;
  }

  private passTime(dt: number) {
    if (dt <= 0) return;
    this.st.clock.t += dt;
    driftEconomy(this.st.economy, dt, this.rng);
    ensureCalendar(this.st.economy, this.t, this.rng, (p) => this.nextId(p));
    if (accrueLoans(this, dt)) this.setGameOver('default');
  }

  private onClose() {
    this.st.market.closed = true;
    this.st.closedSince = this.t;
    this.notify('info', 'market-close', { zh: '周末休市：市场已收盘', ja: '週末休場：市場はクローズしました' });
  }

  private onReopen() {
    const ms = this.st.market;
    if (!ms.closed) return;
    const closedFor = this.t - (this.st.closedSince ?? this.t);
    ms.closed = false;
    this.st.closedSince = null;
    const before = this.quotes.USDJPY?.bid;
    applyWeekendGap(ms, closedFor, this.rng, this.st.marketSettings);
    this.refreshQuotes();
    for (const p of PAIRS) this.candles.update(p.sym, this.t, this.quotes[p.sym].bid, 1);
    const after = this.quotes.USDJPY.bid;
    const gapPips = before ? Math.round((after - before) * 1000) / 10 : 0;
    this.notify('info', 'market-open', {
      zh: `市场重新开盘（USD/JPY 跳空 ${gapPips >= 0 ? '+' : ''}${gapPips} pips），开盘初期点差扩大`,
      ja: `市場オープン（ドル円の窓 ${gapPips >= 0 ? '+' : ''}${gapPips} pips）、オープン直後はスプレッド拡大`,
    });
    processTriggers(this);
    checkRisk(this);
  }

  private substep(dt: number) {
    const st = this.st;
    const ms = st.market;
    const s = st.marketSettings;
    const t0 = st.clock.t;
    st.clock.t += dt;
    const t = st.clock.t;

    // 1) 事件（发生在价格演化之前，保证因果）
    if (t > st.economy.generatedUntil - 3 * 86400) ensureCalendar(st.economy, t, this.rng, (p) => this.nextId(p));
    driftEconomy(st.economy, dt, this.rng);
    const reg = updateRegime(ms, t, this.rng, s);
    if (reg && reg !== 'normal') {
      this.notify('info', 'regime', { zh: `市场状态切换：${REGIME_LABEL[reg].zh}`, ja: `相場状況の変化：${REGIME_LABEL[reg].ja}` });
    }
    localMacro(ms, t, this.rng, s);
    for (const ev of st.economy.calendar) {
      if (ev.released || ev.t > t + 3600) continue;
      if (ev.importance === 3 && !ev.previewed && t >= ev.t - 3600) {
        ev.previewed = true;
        this.pushNews(previewNews(ev, t, (p) => this.nextId(p)));
      }
      if (ev.importance === 3 && t >= ev.t - 60) {
        ms.f[ev.ccy].spreadBoost = Math.max(ms.f[ev.ccy].spreadBoost, 2);
      }
      if (ev.t <= t) this.applyRelease(releaseEvent(st.economy, ev, this.rng, s, (p) => this.nextId(p)));
    }
    const br = maybeBreaking(t, dt, this.rng, s, this.quotes.USDJPY?.mid ?? 150, (p) => this.nextId(p));
    if (br) this.applyBreaking(br);

    // 2) 价格演化与报价
    const act = stepMarket(ms, dt, t, this.rng, s);
    this.refreshQuotes();
    for (const p of PAIRS) {
      const v = Math.max(1, Math.round(((act[p.base] ?? 1) + (act[p.quote] ?? 1)) * (dt / 4) * 1.5));
      this.candles.update(p.sym, t, this.quotes[p.sym].bid, v);
    }

    // 3) 账户：掉期、贷款利息、挂单/止盈止损、风控
    for (const r of rolloversBetween(t0, t)) applyRollover(this, r);
    if (accrueLoans(this, dt)) this.setGameOver('default');
    processTriggers(this);
    checkRisk(this);
  }

  private applyRelease(r: ReleaseResult) {
    const imp = r.event.importance;
    applyShock(this.st.market, r.event.ccy, r.shock, {
      immediate: 0.65, duration: 240, vol: [0.3, 0.8, 1.5][imp - 1], spread: [1, 3, 6][imp - 1],
    });
    this.pushNews(r.news);
    if (!this.quiet) this.outbox.releases.push(r);
    if (imp === 3) {
      this.outbox.majorEvent = true;
      this.notify('news', 'major-news', r.news.title, true);
    }
  }

  applyBreaking(b: BreakingEvent) {
    for (const sh of b.shocks) {
      applyShock(this.st.market, sh.ccy, sh.size, { immediate: sh.immediate, duration: sh.duration, vol: sh.vol, spread: sh.spread });
    }
    if (b.regime) setRegime(this.st.market, b.regime, this.t, this.rng, this.st.marketSettings);
    this.pushNews(b.news);
    if (b.news.importance >= 3) {
      this.outbox.majorEvent = true;
      this.notify('news', 'breaking', b.news.title, true);
    } else {
      this.notify('news', 'breaking', b.news.title);
    }
  }

  applyAiMacro(d: MacroDirective) {
    applyMacro(this.st.market, d, this.rng, this.st.marketSettings);
    if (d.regime && d.regime !== this.st.market.regime.kind && this.st.market.regime.kind !== 'flash') {
      setRegime(this.st.market, d.regime, this.t, this.rng, this.st.marketSettings);
    }
  }

  private afterAdvance() {
    const s = this.summary();
    const stats = this.st.stats;
    if (s.equity > stats.peakEquity) stats.peakEquity = s.equity;
    if (stats.peakEquity > 0) {
      const dd = ((stats.peakEquity - s.equity) / stats.peakEquity) * 100;
      if (dd > stats.maxDrawdownPct) stats.maxDrawdownPct = Math.min(dd, 9999);
    }
    this.recordCurve(false);
    this.checkBankrupt(s);
  }

  recordCurve(force: boolean) {
    const st = this.st;
    if (!force && this.t - st.lastCurveT < 60) return;
    const s = this.summary();
    st.lastCurveT = this.t;
    st.equityCurve.push({ t: this.t, equity: s.equity, netWorth: s.netWorth });
    if (st.equityCurve.length > CAP.curve) {
      // 抽稀前半段，保留最近的细节
      const half = Math.floor(st.equityCurve.length / 2);
      st.equityCurve = st.equityCurve.slice(0, half).filter((_, i) => i % 2 === 0).concat(st.equityCurve.slice(half));
    }
  }

  private checkBankrupt(s: AccountSummary) {
    if (this.st.gameOver || this.quiet) return;
    if (this.st.positions.length > 0) return;
    const minMargin = positionMargin(this, 'USDJPY', this.st.risk.minUnits) * 1.1;
    if (s.equity + s.loanAvailable < minMargin) this.setGameOver('bankrupt');
  }

  setGameOver(reason: 'bankrupt' | 'default' | 'declared') {
    if (this.st.gameOver) return;
    const s = this.summary();
    this.st.gameOver = { reason, t: this.t, netWorth: s.netWorth };
    this.st.clock.paused = true;
    this.notify('danger', 'gameover', {
      zh: reason === 'declared' ? '你申请了个人破产。' : reason === 'default' ? '贷款违约，宣告破产。' : '资金耗尽且无法再借贷——破产。',
      ja: reason === 'declared' ? '自己破産を申し立てました。' : reason === 'default' ? '債務不履行により破産。' : '資金が尽き、これ以上借りることもできない――破産。',
    }, true);
  }

  // ---------- 账户 ----------
  summary(): AccountSummary {
    return summarize(this);
  }

  // ---------- 操作（玩家与 AI 共用） ----------
  order(req: OrderRequest): ExecResult {
    const r = placeOrder(this, req);
    if (r.ok) { checkRisk(this); this.afterAdvance(); }
    return r;
  }

  close(id: string, units: number | null): ExecResult {
    const r = closePosition(this, id, units, 'close');
    if (r.ok) { handleNegative(this); checkRisk(this); this.afterAdvance(); }
    return r;
  }

  closeAll(filter?: { sym?: string; source?: 'player' | 'ai' }): ExecResult[] {
    const targets = this.st.positions.filter((p) => (!filter?.sym || p.sym === filter.sym) && (!filter?.source || p.source === filter.source));
    const out = targets.map((p) => closePosition(this, p.id, null, 'close'));
    handleNegative(this);
    checkRisk(this);
    this.afterAdvance();
    return out;
  }

  modify(id: string, sl: number | null, tp: number | null, trail: number | null) {
    return modifyPosition(this, id, sl, tp, trail);
  }

  cancel(id: string) {
    return cancelOrder(this, id);
  }

  borrow(amount: number, planId: string): LoanResult {
    const r = borrow(this, amount, planId);
    if (r.ok) this.afterAdvance();
    return r;
  }

  repay(loanId: string, amount: number): LoanResult {
    const r = repay(this, loanId, amount);
    if (r.ok) this.afterAdvance();
    return r;
  }

  drainOutbox(): Outbox {
    const o = this.outbox;
    this.outbox = Game.emptyOutbox();
    return o;
  }
}
