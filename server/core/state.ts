// 存档中的完整游戏状态（K线已收盘部分单独存储于数据库）。
import type {
  AccountCcy, AiLogEntry, AiRole, AiRoleConfig, AiUsage, AutoTraderSettings, Candle, ClockState, GameOverInfo,
  GameStats, Loan, MarketSettings, NewsItem, Notice, PendingOrder, Position, RiskSettings, TF, TradeRecord,
} from '../../shared/types';
import type { MarketState } from './market';
import type { EconomyState } from './economy';

export interface AccountState {
  username: string;
  ccy: AccountCcy;
  maxLeverage: number;
  balance: number;
  realized: number;
  totalSwap: number;
  initialCapital: number;
  marginCallActive: boolean;
}

export interface GameState {
  version: 1;
  saveId: string;
  name: string;
  createdAt: number;
  seed: number;
  rng: number[];        // 行情随机数状态
  rngExec: number[];    // 成交（滑点）随机数状态：与行情分离，玩家操作不会改变行情路径
  clock: ClockState;
  closedSince: number | null;   // 休市开始时间
  market: MarketState;
  marketSettings: MarketSettings;
  risk: RiskSettings;
  economy: EconomyState;
  account: AccountState;
  positions: Position[];
  orders: PendingOrder[];
  trades: TradeRecord[];
  loans: Loan[];
  news: NewsItem[];
  notices: Notice[];
  aiLog: AiLogEntry[];
  equityCurve: { t: number; equity: number; netWorth: number }[];
  lastCurveT: number;
  stats: GameStats;
  ai: {
    roles: Record<AiRole, AiRoleConfig>;
    acc: Record<AiRole, number>;       // 自上次调用起累计的运行秒数
    usage: Record<AiRole, AiUsage>;
  };
  autoTrader: AutoTraderSettings;
  seq: { id: number; notice: number };
  forming: Record<string, Partial<Record<TF, Candle>>>;
  gameOver: GameOverInfo | null;
}

export const DEFAULT_MARKET_SETTINGS: MarketSettings = {
  volMult: 1.5, trendStrength: 1, meanReversion: 1, jumpRate: 1, blackSwanPerYear: 2,
  gapMult: 1, spreadMult: 1, newsImpact: 1, sessionEffects: true,
};

export const DEFAULT_RISK: RiskSettings = {
  marginCallLevel: 100, stopOutLevel: 50, stopOutMode: 'all', negativeBalanceProtection: false,
  slippage: 1, lotUnits: 10_000, minUnits: 1_000, maxUnitsPerOrder: 50_000_000,
};

export const DEFAULT_AUTOTRADER: AutoTraderSettings = {
  enabled: false, strategy: 'trend', risk: 'balanced', maxLotsPerOrder: 10, maxPositions: 3,
  maxEffectiveLeverage: 200, pairs: ['USDJPY', 'EURUSD', 'GBPJPY', 'AUDJPY', 'EURJPY'], requireStopLoss: true, tf: '5m', notes: '',
};

export function defaultRoles(): Record<AiRole, AiRoleConfig> {
  return {
    news: { enabled: false, profileId: null, intervalSec: 180, temperature: 0.8 },
    macro: { enabled: false, profileId: null, intervalSec: 120, temperature: 0.5 },
    trader: { enabled: false, profileId: null, intervalSec: 40, temperature: 0.3 },
  };
}

export function emptyUsage(): AiUsage {
  return { calls: 0, fails: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
}
