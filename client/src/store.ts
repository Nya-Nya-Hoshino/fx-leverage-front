import { create } from 'zustand';

export type ThemePref = 'system' | 'light' | 'dark' | 'navy';
import type {
  AiLogEntry, AiProfilePublic, AiRole, AiRoleConfig, AutoTraderSettings, Lang, MarketSettings, NewsItem, Notice, PairDef,
  RiskSettings, TF, TickMessage, TradeRecord, LoanPlan, I18nText,
} from '../../shared/types';

export interface Meta {
  pairs: PairDef[];
  tfs: TF[];
  leverageOptions: number[];
  loanPlans: (LoanPlan & { name: I18nText })[];
  activeSaveId: string | null;
  lastSaveId: string | null;
}

export interface FullSettings {
  marketSettings: MarketSettings;
  risk: RiskSettings;
  autoTrader: AutoTraderSettings;
  roles: Record<AiRole, AiRoleConfig>;
}

export interface Effect { id: number; kind: 'stopout' | 'breaking' | 'margin-call' | 'profit' | 'loss' | 'gameover'; text?: I18nText; value?: number }

interface S {
  lang: Lang;
  meta: Meta | null;
  saveId: string | null;
  active: boolean;
  saveName: string;
  username: string;
  seed: number;
  tick: TickMessage | null;
  news: NewsItem[];
  notices: Notice[];
  aiLog: AiLogEntry[];
  trades: TradeRecord[];
  curve: { t: number; equity: number; netWorth: number }[];
  settings: FullSettings | null;
  profiles: AiProfilePublic[];
  sym: string;
  tf: TF;
  effects: Effect[];
  toasts: Notice[];
  connected: boolean;
  repayable: number;
  theme: ThemePref;
  themeRev: number;
  set: (p: Partial<S>) => void;
}

export const useS = create<S>((set) => ({
  lang: (localStorage.getItem('fx.lang') as Lang) || 'zh',
  meta: null,
  saveId: null,
  active: false,
  saveName: '',
  username: '',
  seed: 0,
  tick: null,
  news: [],
  notices: [],
  aiLog: [],
  trades: [],
  curve: [],
  settings: null,
  profiles: [],
  sym: localStorage.getItem('fx.sym') || 'USDJPY',
  tf: (localStorage.getItem('fx.tf') as TF) || '1m',
  effects: [],
  toasts: [],
  connected: false,
  repayable: 0,
  theme: ((): ThemePref => { try { return (localStorage.getItem('fx.theme') as ThemePref) || 'system'; } catch { return 'system'; } })(),
  themeRev: 0,
  set: (p) => set(p),
}));

export function useT() {
  const lang = useS((s) => s.lang);
  return (zh: string, ja: string) => (lang === 'ja' ? ja : zh);
}

export function tx(text: I18nText | undefined, lang: Lang) {
  return text ? text[lang] : '';
}

let effectId = 0;
export function pushEffect(e: Omit<Effect, 'id'>) {
  const id = ++effectId;
  useS.setState((s) => ({ effects: [...s.effects, { ...e, id }] }));
  setTimeout(() => useS.setState((s) => ({ effects: s.effects.filter((x) => x.id !== id) })), e.kind === 'stopout' ? 4200 : 3200);
}
