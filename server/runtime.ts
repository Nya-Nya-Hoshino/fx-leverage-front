// 运行时：管理当前载入的存档、实时 Tick 定时器、AI 调度、自动保存与 WebSocket 推送。
import type { AiLogEntry, AiProfilePublic, AiRole, TF, TickMessage } from '../shared/types';
import { PAIR_MAP } from '../shared/instruments';
import { Game, type NewGameOptions, type Outbox } from './core/game';
import { MAX_BARS } from './core/candles';
import { sessionFlags } from './core/clock';
import { REGIME_LABEL } from './core/market';
import { econSnapshot, type ReleaseResult } from './core/economy';
import { positionMargin, positionPnl, swapTable } from './core/account';
import { keyHint, type ClientLike, type GameStore, type ProfileRow, type SecretBox } from './store';
import { LlmClient, callJson, type AiProfile } from './ai/llm';
import { BreakingSchema, MacroSchema, NewsArticleSchema, TraderSchema } from './ai/schemas';
import {
  breakingPrompt, breakingToEvent, executeTrader, macroPrompt, macroToDirective, releaseArticlePrompt, traderPrompt,
} from './ai/agents';
import { localDecide } from './ai/localTrader';

interface ClientSub { sym: string; tf: TF; lastBarT: number }

export class Runtime {
  game: Game | null = null;
  token = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  clients = new Map<ClientLike, ClientSub>();
  aiBusy: Record<AiRole, boolean> = { news: false, macro: false, trader: false };
  private aborts = new Set<AbortController>();
  private releaseQueue: ReleaseResult[] = [];
  private lastAutosave = Date.now();
  /** 自动保存间隔（毫秒） */
  autosaveMs = 30_000;

  constructor(public db: GameStore, public keys: SecretBox, public llm: LlmClient = new LlmClient()) {}

  // ---------------- AI 配置 ----------------
  profileFromRow(r: ProfileRow): AiProfile {
    return {
      id: r.id, name: r.name, provider: r.provider, baseUrl: r.base_url, apiKey: this.keys.decrypt(r.api_key_enc), model: r.model,
      maxTokens: r.max_tokens, timeoutMs: r.timeout_ms, jsonMode: !!r.json_mode, priceIn: r.price_in, priceOut: r.price_out,
      minIntervalMs: r.min_interval_ms, maxRetries: r.max_retries, extraBody: r.extra_json ?? '',
    };
  }

  profilesPublic(): AiProfilePublic[] {
    return this.db.listProfiles().map((r) => {
      const key = this.keys.decrypt(r.api_key_enc);
      const p = this.profileFromRow(r);
      const { apiKey: _omit, ...rest } = p;
      return { ...rest, extraBody: rest.extraBody ?? '', hasKey: !!key, keyHint: keyHint(key) };
    });
  }

  getProfile(id: string | null): AiProfile | null {
    if (!id) return null;
    const r = this.db.listProfiles().find((x) => x.id === id);
    return r ? this.profileFromRow(r) : null;
  }

  saveProfile(input: Omit<AiProfile, 'id' | 'apiKey'> & { id?: string; apiKey?: string | null }) {
    const id = input.id || globalThis.crypto.randomUUID();
    const existing = this.db.listProfiles().find((x) => x.id === id);
    const enc = input.apiKey ? this.keys.encrypt(input.apiKey) : input.apiKey === '' ? '' : existing?.api_key_enc ?? '';
    this.db.upsertProfile({
      id, name: input.name, provider: input.provider, base_url: input.baseUrl, api_key_enc: enc, model: input.model,
      max_tokens: input.maxTokens, timeout_ms: input.timeoutMs, json_mode: input.jsonMode ? 1 : 0, price_in: input.priceIn,
      price_out: input.priceOut, min_interval_ms: input.minIntervalMs, max_retries: input.maxRetries,
      extra_json: input.extraBody ?? '',
    });
    return id;
  }

  // ---------------- 存档管理 ----------------
  async create(opts: Omit<NewGameOptions, 'saveId'> & { saveId?: string }) {
    await this.unload();
    const g = Game.create({ ...opts, saveId: opts.saveId ?? globalThis.crypto.randomUUID() });
    this.attach(g);
    this.persist();
    return g;
  }

  async load(id: string) {
    if (this.game?.st.saveId === id) return this.game;
    const st = this.db.loadState(id);
    if (!st) throw new Error('存档不存在');
    await this.unload();
    const g = Game.restore(st, await this.db.loadCandles(id));
    this.attach(g);
    return g;
  }

  async reset(id: string) {
    const st = this.db.loadState(id);
    if (!st) throw new Error('存档不存在');
    await this.unload();
    this.db.deleteSave(id);
    const g = Game.create({
      saveId: id, name: st.name, username: st.account.username, accountCcy: st.account.ccy, maxLeverage: st.account.maxLeverage,
      marketMode: st.market.mode,
    });
    g.st.ai.roles = st.ai.roles;
    this.attach(g);
    this.persist();
    return g;
  }

  async remove(id: string) {
    if (this.game?.st.saveId === id) {
      this.stopTimer();
      this.abortAll();
      this.game = null;
      this.token++;
      this.broadcastReload();
    }
    this.db.deleteSave(id);
  }

  async unload() {
    if (!this.game) return;
    this.stopTimer();
    this.abortAll();
    this.persist();
    this.game = null;
    this.token++;
    this.releaseQueue = [];
  }

  private attach(g: Game) {
    this.game = g;
    this.token++;
    this.aiBusy = { news: false, macro: false, trader: false };
    this.db.setMeta('lastSave', g.st.saveId);
    for (const sub of this.clients.values()) sub.lastBarT = Infinity;
    this.startTimer();
    this.broadcastReload();
  }

  persist() {
    const g = this.game;
    if (!g) return;
    const st = g.serialize();
    const bars = g.candles.takeUnpersisted();
    const trim: { sym: string; tf: TF; t: number }[] = [];
    for (const sym of Object.keys(g.candles.data)) {
      for (const [tf, s] of Object.entries(g.candles.data[sym])) {
        if (s.closed.length >= MAX_BARS) trim.push({ sym, tf: tf as TF, t: s.closed[s.closed.length - MAX_BARS].t });
      }
    }
    const sum = g.summary();
    this.db.writeSave(st, { equity: sum.equity, netWorth: sum.netWorth, status: sum.status }, bars, trim);
    this.lastAutosave = Date.now();
  }

  // ---------------- 主循环 ----------------
  private startTimer() {
    this.stopTimer();
    const loop = () => {
      const g = this.game;
      if (!g) return;
      this.timer = setTimeout(() => {
        try { this.tick(); } catch (e) { console.error('[tick]', e); }
        loop();
      }, g.st.clock.tickMs);
    };
    loop();
  }

  private stopTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  tick() {
    const g = this.game;
    if (!g) return;
    const running = !g.st.clock.paused && !g.st.gameOver;
    const dt = g.st.clock.tickMs / 1000;
    g.advance(dt);
    if (running) this.scheduleAi(dt);
    this.broadcast();
    if (Date.now() - this.lastAutosave > this.autosaveMs) this.persist();
  }

  private scheduleAi(dt: number) {
    const g = this.game!;
    const roles = g.st.ai.roles;
    const acc = g.st.ai.acc;
    if (g.st.autoTrader.enabled) {
      acc.trader += dt;
      if (acc.trader >= roles.trader.intervalSec && !this.aiBusy.trader) { acc.trader = 0; void this.runTrader(); }
    }
    if (g.st.market.mode === 'ai' && roles.macro.enabled) {
      acc.macro += dt;
      if (acc.macro >= roles.macro.intervalSec && !this.aiBusy.macro) { acc.macro = 0; void this.runMacro(); }
    }
    if (roles.news.enabled && roles.news.profileId) {
      acc.news += dt;
      if (acc.news >= roles.news.intervalSec && !this.aiBusy.news) { acc.news = 0; void this.runBreaking(); }
    }
  }

  private abortAll() {
    for (const a of this.aborts) a.abort();
    this.aborts.clear();
  }

  private log(role: AiRole, engine: 'ai' | 'local', ok: boolean, summary: string, extra: Partial<AiLogEntry> = {}) {
    const g = this.game;
    if (!g) return;
    g.pushAiLog({ id: g.nextId('ai'), t: g.t, realTime: Date.now(), role, engine, ok, summary, ...extra });
  }

  private usage(role: AiRole, p: AiProfile, tin: number, tout: number, failed: boolean) {
    const u = this.game!.st.ai.usage[role];
    u.calls++;
    if (failed) u.fails++;
    u.tokensIn += tin;
    u.tokensOut += tout;
    u.cost += (tin * p.priceIn + tout * p.priceOut) / 1e6;
  }

  /** 包装一次 AI 调用：令牌校验（防止存档切换后串号）、取消、计费 */
  private async aiCall<T>(role: AiRole, p: AiProfile, prompt: { system: string; user: string }, schema: any): Promise<{ data: T; tin: number; tout: number; lat: number } | { error: string }> {
    const g = this.game!;
    const tok = this.token;
    const ac = new AbortController();
    this.aborts.add(ac);
    try {
      const r = await callJson<T>(this.llm, p, prompt.system, prompt.user, schema, g.st.ai.roles[role].temperature, ac.signal);
      if (tok !== this.token || !this.game) return { error: 'stale' };
      this.usage(role, p, r.tokensIn, r.tokensOut, false);
      return { data: r.data, tin: r.tokensIn, tout: r.tokensOut, lat: r.latencyMs };
    } catch (e: any) {
      if (tok !== this.token || !this.game) return { error: 'stale' };
      this.usage(role, p, e?.usage?.tin ?? 0, e?.usage?.tout ?? 0, true);
      return { error: String(e?.message ?? e).slice(0, 300) };
    } finally {
      this.aborts.delete(ac);
    }
  }

  async runTrader(force = false) {
    const g = this.game;
    if (!g || this.aiBusy.trader || g.st.gameOver) return;
    if (!force && !g.st.autoTrader.enabled) return;
    this.aiBusy.trader = true;
    const tok = this.token;
    try {
      const role = g.st.ai.roles.trader;
      const p = role.enabled ? this.getProfile(role.profileId) : null;
      if (p) {
        const r = await this.aiCall<any>('trader', p, traderPrompt(g), TraderSchema);
        if ('error' in r) {
          if (r.error === 'stale') return;
          this.log('trader', 'ai', false, `AI 交易员调用失败，降级为本地策略：${r.error}`);
        } else {
          if (!g.st.autoTrader.enabled && !force) return;
          const res = g.marketOpen() ? executeTrader(g, r.data) : [{ text: '-', ok: false, result: '休市，未执行' }];
          this.log('trader', 'ai', true, r.data.analysis || '(无分析)', {
            detail: `信心 ${r.data.confidence}`, actions: res, tokensIn: r.tin, tokensOut: r.tout, latencyMs: r.lat,
          });
          return;
        }
      }
      if (tok !== this.token) return;
      const out = localDecide(g);
      const res = g.marketOpen() ? executeTrader(g, out) : [{ text: '-', ok: false, result: '休市，未执行' }];
      this.log('trader', 'local', true, out.analysis, { actions: res });
    } finally {
      if (tok === this.token) this.aiBusy.trader = false;
      this.broadcast();
    }
  }

  async runMacro() {
    const g = this.game;
    if (!g || this.aiBusy.macro) return;
    const p = this.getProfile(g.st.ai.roles.macro.profileId);
    if (!p) { this.log('macro', 'local', false, '未配置 AI 宏观模型，使用本地宏观生成器'); return; }
    this.aiBusy.macro = true;
    const tok = this.token;
    try {
      const r = await this.aiCall<any>('macro', p, macroPrompt(g), MacroSchema);
      if ('error' in r) {
        if (r.error !== 'stale') this.log('macro', 'ai', false, `宏观 AI 调用失败，本地引擎继续运行：${r.error}`);
        return;
      }
      const d = macroToDirective(g, r.data);
      g.applyAiMacro(d);
      const top = Object.entries(d.ccys).sort((a, b) => Math.abs(b[1]!.bias) - Math.abs(a[1]!.bias)).slice(0, 4)
        .map(([c, v]) => `${c} ${v!.bias >= 0 ? '+' : ''}${v!.bias.toFixed(2)}`).join(' ');
      this.log('macro', 'ai', true, r.data.commentary || '宏观参数已更新', {
        detail: `状态 ${REGIME_LABEL[r.data.regime as keyof typeof REGIME_LABEL].zh} 风险 ${r.data.risk_sentiment.toFixed(2)} 期限 ${r.data.horizon_hours}h 倾向 ${top}`,
        tokensIn: r.tin, tokensOut: r.tout, latencyMs: r.lat,
      });
    } finally {
      if (tok === this.token) this.aiBusy.macro = false;
    }
  }

  async runBreaking() {
    const g = this.game;
    if (!g || this.aiBusy.news) return;
    const p = this.getProfile(g.st.ai.roles.news.profileId);
    if (!p) return;
    this.aiBusy.news = true;
    const tok = this.token;
    try {
      const r = await this.aiCall<any>('news', p, breakingPrompt(g), BreakingSchema);
      if ('error' in r) {
        if (r.error !== 'stale') this.log('news', 'ai', false, `新闻 AI 调用失败（本地新闻系统继续运行）：${r.error}`);
        return;
      }
      if (!g.marketOpen()) { this.log('news', 'ai', true, '休市中，突发新闻暂不发布'); return; }
      const ev = breakingToEvent(g, r.data);
      if (ev) {
        g.applyBreaking(ev);
        this.log('news', 'ai', true, `发布突发新闻：${ev.news.title.zh}`, { detail: JSON.stringify(r.data.effects), tokensIn: r.tin, tokensOut: r.tout, latencyMs: r.lat });
      } else {
        this.log('news', 'ai', true, '本轮无突发新闻', { tokensIn: r.tin, tokensOut: r.tout, latencyMs: r.lat });
      }
    } finally {
      if (tok === this.token) this.aiBusy.news = false;
      this.processReleaseQueue();
    }
  }

  private handleReleases(list: ReleaseResult[]) {
    const g = this.game!;
    const role = g.st.ai.roles.news;
    if (!role.enabled || !role.profileId) return;
    this.releaseQueue.push(...list.filter((r) => r.event.importance >= 2));
    if (this.releaseQueue.length > 4) this.releaseQueue.splice(0, this.releaseQueue.length - 4);
    this.processReleaseQueue();
  }

  private async processReleaseQueue() {
    const g = this.game;
    if (!g || this.aiBusy.news || this.releaseQueue.length === 0) return;
    const p = this.getProfile(g.st.ai.roles.news.profileId);
    if (!p) { this.releaseQueue = []; return; }
    const item = this.releaseQueue.shift()!;
    this.aiBusy.news = true;
    const tok = this.token;
    try {
      const r = await this.aiCall<any>('news', p, releaseArticlePrompt(g, item.event, item.news), NewsArticleSchema);
      if ('error' in r) {
        if (r.error !== 'stale') this.log('news', 'ai', false, `新闻改写失败，保留本地稿：${r.error}`);
        return;
      }
      g.updateNews(item.news.id, { title: { zh: r.data.title_zh, ja: r.data.title_ja }, body: { zh: r.data.body_zh, ja: r.data.body_ja }, source: 'ai' });
      this.log('news', 'ai', true, `撰写快讯：${r.data.title_zh}`, { tokensIn: r.tin, tokensOut: r.tout, latencyMs: r.lat });
    } finally {
      if (tok === this.token) {
        this.aiBusy.news = false;
        setTimeout(() => this.processReleaseQueue(), 0);
      }
    }
  }

  async testProfile(id: string) {
    const p = this.getProfile(id);
    if (!p) throw new Error('配置不存在');
    const r = await this.llm.chat(p, '只输出 JSON。', '请输出 {"ok":true,"model":"你的模型名"}', 0);
    return { ok: true, latencyMs: r.latencyMs, tokensIn: r.tokensIn, tokensOut: r.tokensOut, sample: r.text.slice(0, 200) };
  }

  // ---------------- 推送 ----------------
  subscribe(ws: ClientLike, sym: string, tf: TF, since: number) {
    if (!PAIR_MAP[sym]) return;
    this.clients.set(ws, { sym, tf, lastBarT: since });
  }

  broadcastReload() {
    const msg = JSON.stringify({ type: 'reload', saveId: this.game?.st.saveId ?? null });
    for (const ws of this.clients.keys()) if (ws.readyState === 1) ws.send(msg);
  }

  broadcast() {
    const g = this.game;
    if (!g) return;
    const ob = g.drainOutbox();
    if (ob.releases.length) this.handleReleases(ob.releases);
    const base = this.tickBase(g, ob);
    for (const [ws, sub] of this.clients) {
      if (ws.readyState !== 1) continue;
      let bars: TickMessage['bars'] = null;
      if (sub.lastBarT !== Infinity) {
        const b = g.candles.barsSince(sub.sym, sub.tf, sub.lastBarT);
        if (b.length) {
          bars = { sym: sub.sym, tf: sub.tf, bars: b.slice(-500) };
          sub.lastBarT = b[b.length - 1].t;
        }
      }
      ws.send(JSON.stringify({ ...base, bars }));
    }
  }

  tickBase(g: Game, ob: Outbox): Omit<TickMessage, 'bars'> {
    const sum = g.summary();
    const last = g.st.equityCurve[g.st.equityCurve.length - 1] ?? null;
    return {
      type: 'tick',
      saveId: g.st.saveId,
      clock: g.st.clock,
      session: sessionFlags(g.t),
      regime: { kind: g.st.market.regime.kind, label: REGIME_LABEL[g.st.market.regime.kind], risk: g.st.market.risk, mode: g.st.market.mode },
      quotes: Object.values(g.quotes),
      account: sum,
      positions: g.st.positions.map((p) => {
        const q = g.quotes[p.sym];
        const pnl = positionPnl(g, p) + p.swap;
        const cur = p.side === 'buy' ? q.bid : q.ask;
        const pips = ((p.side === 'buy' ? cur - p.openPrice : p.openPrice - cur) / PAIR_MAP[p.sym].pip);
        return { ...p, pnl, pips: Math.round(pips * 10) / 10, margin: positionMargin(g, p.sym, p.units), current: cur };
      }),
      orders: g.st.orders,
      loans: g.st.loans,
      notices: ob.notices,
      news: ob.news,
      aiLog: ob.aiLog,
      trades: ob.trades,
      equityPoint: last,
      aiBusy: { ...this.aiBusy },
      autoTrader: g.st.autoTrader,
      gameOver: g.st.gameOver,
      swaps: swapTable(g),
      econ: econSnapshot(g.st.economy),
      calendar: g.st.economy.calendar.filter((e) => e.t > g.t - 6 * 3600).slice(0, 40),
      stats: g.st.stats,
      aiUsage: g.st.ai.usage,
      macro: g.st.market.macro ? { source: g.st.market.macro.source, commentary: g.st.market.macro.commentary, until: g.st.market.macro.until } : null,
    };
  }

  shutdown() {
    this.stopTimer();
    this.abortAll();
    this.persist();
  }
}
