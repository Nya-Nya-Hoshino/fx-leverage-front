// 前后端共享的数据结构。服务器是唯一的真实状态来源，前端只读取这些结构进行展示。

export type Ccy =
  | 'USD' | 'JPY' | 'EUR' | 'GBP' | 'CHF' | 'AUD' | 'NZD' | 'CAD'
  | 'CNH' | 'HKD' | 'TWD' | 'KRW' | 'SGD';

/** 账户本位币。CNY 账户在行情侧使用离岸人民币 CNH 汇率进行换算。 */
export type AccountCcy = 'JPY' | 'CNY';

export type Lang = 'zh' | 'ja';
export type Side = 'buy' | 'sell';
export type TF = '15s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export const TFS: TF[] = ['15s', '1m', '5m', '15m', '1h', '4h', '1d'];
export const TF_SEC: Record<TF, number> = {
  '15s': 15, '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
};

export interface PairDef {
  sym: string;          // 例如 USDJPY
  base: Ccy;
  quote: Ccy;
  pip: number;          // 1 pip 对应的价格变化
  digits: number;       // 报价小数位
  baseSpread: number;   // 基础点差（pips）
  featured?: boolean;
}

export interface Quote {
  sym: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;       // pips
  open: number;         // 当日开盘（bid）
  high: number;
  low: number;
  dir: -1 | 0 | 1;      // 与上一 Tick 比较的方向
}

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

export type MarketMode = 'random' | 'ai';
export type RegimeKind = 'normal' | 'trend' | 'range' | 'panic' | 'illiquid' | 'flash';

export type OrderType = 'market' | 'limit' | 'stop';
export type Source = 'player' | 'ai';

export interface Position {
  id: string;
  sym: string;
  side: Side;
  units: number;
  openPrice: number;
  openTime: number;
  sl: number | null;
  tp: number | null;
  trailPips: number | null;
  trailRef: number | null;
  swap: number;          // 累计未结算掉期（账户本位币）
  source: Source;
  comment?: string;
}

export interface PendingOrder {
  id: string;
  sym: string;
  side: Side;
  type: 'limit' | 'stop';
  price: number;
  units: number;
  sl: number | null;
  tp: number | null;
  trailPips: number | null;
  createdAt: number;
  source: Source;
  comment?: string;
}

export type TradeAction =
  | 'open' | 'close' | 'partial' | 'sl' | 'tp' | 'trail' | 'stopout' | 'fill-limit' | 'fill-stop';

export interface TradeRecord {
  id: string;
  t: number;
  sym: string;
  side: Side;           // 持仓方向
  action: TradeAction;
  units: number;
  price: number;
  openPrice?: number;
  pnl: number;          // 已实现盈亏（账户本位币，含掉期）
  swap: number;
  slippagePips: number;
  positionId: string;
  source: Source;
  balanceAfter: number;
}

export interface LoanPlan {
  id: string;
  apr: number;          // 年利率
  termDays: number;
  graceDays: number;
}

export interface Loan {
  id: string;
  planId: string;
  principal: number;     // 初始本金
  outstanding: number;   // 未偿本金
  interest: number;      // 已计提未支付利息
  apr: number;
  takenAt: number;
  dueAt: number;
  status: 'active' | 'overdue' | 'repaid' | 'defaulted';
  remindedDue?: boolean;
  paidInterest: number;
}

export interface AccountSummary {
  ccy: AccountCcy;
  maxLeverage: number;
  balance: number;
  unrealized: number;      // 未实现盈亏（含掉期）
  equity: number;
  usedMargin: number;
  freeMargin: number;
  marginLevel: number | null; // % ，无持仓时为 null
  notional: number;
  effectiveLeverage: number;
  realized: number;
  totalSwap: number;
  loanDebt: number;        // 贷款本金+利息
  loanPrincipal: number;
  loanLimit: number;
  loanAvailable: number;
  netWorth: number;        // 个人净资产 = 净值 - 贷款债务
  totalAssets: number;     // 总资产 = max(净值,0)
  liabilities: number;     // 负债 = 贷款债务 + 负余额欠款
  initialCapital: number;
  status: 'normal' | 'margin-call' | 'stop-out' | 'negative' | 'insolvent' | 'bankrupt';
}

export interface I18nText { zh: string; ja: string }

export interface NewsItem {
  id: string;
  t: number;
  kind: 'release' | 'breaking' | 'preview' | 'market' | 'system';
  title: I18nText;
  body: I18nText;
  ccys: Ccy[];
  importance: 1 | 2 | 3;
  expectation?: I18nText;
  eventId?: string;
  source: 'ai' | 'local';
}

export type IndicatorKind = 'CPI' | 'NFP' | 'UNEMP' | 'GDP' | 'PMI' | 'RETAIL' | 'RATE' | 'TRADE' | 'SENTI';

export interface CalendarEvent {
  id: string;
  t: number;
  ccy: Ccy;
  kind: IndicatorKind;
  importance: 1 | 2 | 3;
  forecast: number;
  previous: number;
  actual: number | null;
  unit: string;
  surprise: number | null; // 标准化意外值
  released: boolean;
  previewed?: boolean;
}

export interface Notice {
  seq: number;
  t: number;
  level: 'info' | 'warn' | 'danger' | 'success' | 'news';
  code: string;
  text: I18nText;
  big?: boolean;  // 触发全屏演出
}

export interface AiLogEntry {
  id: string;
  t: number;          // 模拟时间
  realTime: number;
  role: 'news' | 'macro' | 'trader';
  engine: 'ai' | 'local';
  ok: boolean;
  summary: string;
  detail?: string;
  actions?: { text: string; ok: boolean; result: string }[];
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

export type AiRole = 'news' | 'macro' | 'trader';

export interface AiRoleConfig {
  enabled: boolean;
  profileId: string | null;
  intervalSec: number;   // 实时秒（仅在运行中累计）
  temperature: number;
}

export interface AiUsage { calls: number; fails: number; tokensIn: number; tokensOut: number; cost: number }

export interface AiProfilePublic {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyHint: string;
  maxTokens: number;
  timeoutMs: number;
  jsonMode: boolean;
  priceIn: number;     // 每百万 token 价格（任意货币单位，仅统计）
  priceOut: number;
  minIntervalMs: number;
  maxRetries: number;
  extraBody: string;
}

export type TraderStrategy = 'trend' | 'meanrev' | 'breakout' | 'gambler';
export type RiskProfile = 'conservative' | 'balanced' | 'aggressive' | 'degenerate';

export interface AutoTraderSettings {
  enabled: boolean;
  strategy: TraderStrategy;
  risk: RiskProfile;
  maxLotsPerOrder: number;
  maxPositions: number;
  maxEffectiveLeverage: number;
  pairs: string[];
  requireStopLoss: boolean;
  tf: TF;
  notes: string;          // 给 AI 的自定义策略说明
}

export interface MarketSettings {
  volMult: number;
  trendStrength: number;
  meanReversion: number;
  jumpRate: number;
  blackSwanPerYear: number;
  gapMult: number;
  spreadMult: number;
  newsImpact: number;
  sessionEffects: boolean;
}

export interface RiskSettings {
  marginCallLevel: number;
  stopOutLevel: number;
  stopOutMode: 'all' | 'worst';
  negativeBalanceProtection: boolean;
  slippage: number;     // 滑点强度倍数，0 = 无滑点
  lotUnits: number;     // 1 手 = N 货币单位
  minUnits: number;
  maxUnitsPerOrder: number;
}

export interface ClockState {
  t: number;
  speed: number;
  paused: boolean;
  tickMs: number;
  autoSkipWeekend: boolean;
}

export interface SessionFlags { asia: boolean; europe: boolean; us: boolean; open: boolean; label: string }

export interface GameStats {
  peakEquity: number;
  maxDrawdownPct: number;
  trades: number;
  wins: number;
  losses: number;
  stopOuts: number;
  marginCalls: number;
  biggestWin: number;
  biggestLoss: number;
  maxLoanPrincipal: number;
  totalInterestPaid: number;
  totalBorrowed: number;
}

export interface GameOverInfo {
  reason: 'bankrupt' | 'default' | 'declared';
  t: number;
  netWorth: number;
}

export interface EconSnapshot {
  ccy: Ccy;
  rate: number;
  inflation: number;
  unemployment: number;
  gdp: number;
  pmi: number;
  sentiment: number;
  stance: number;
}

/** WebSocket 每个 Tick 推送的增量数据 */
export interface TickMessage {
  type: 'tick';
  saveId: string;
  clock: ClockState;
  session: SessionFlags;
  regime: { kind: RegimeKind; label: I18nText; risk: number; mode: MarketMode };
  quotes: Quote[];
  account: AccountSummary;
  positions: (Position & { pnl: number; pips: number; margin: number; current: number })[];
  orders: PendingOrder[];
  loans: Loan[];
  bars: { sym: string; tf: TF; bars: Candle[] } | null;
  notices: Notice[];
  news: NewsItem[];
  aiLog: AiLogEntry[];
  trades: TradeRecord[];
  equityPoint: { t: number; equity: number; netWorth: number } | null;
  aiBusy: Record<AiRole, boolean>;
  autoTrader: AutoTraderSettings;
  gameOver: GameOverInfo | null;
  swaps: Record<string, { long: number; short: number }>;
  econ: EconSnapshot[];
  calendar: CalendarEvent[];
  stats: GameStats;
  aiUsage: Record<AiRole, AiUsage>;
  macro: { source: 'ai' | 'local'; commentary: string; until: number } | null;
}

export interface SaveListItem {
  id: string;
  name: string;
  username: string;
  accountCcy: AccountCcy;
  maxLeverage: number;
  createdAt: number;
  updatedAt: number;
  simTime: number;
  equity: number;
  netWorth: number;
  status: string;
}
