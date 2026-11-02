// 三个 AI 角色输出的 JSON Schema（zod）。
import { z } from 'zod';
import { CCYS } from '../../shared/instruments';

const ccy = z.enum(CCYS as [string, ...string[]]);
const num = (lo: number, hi: number) => z.coerce.number().transform((v) => Math.max(lo, Math.min(hi, v)));

export const NewsArticleSchema = z.object({
  title_zh: z.string().min(2).max(120),
  title_ja: z.string().min(2).max(120),
  body_zh: z.string().min(2).max(800),
  body_ja: z.string().min(2).max(800),
});
export type NewsArticle = z.infer<typeof NewsArticleSchema>;

export const BreakingSchema = z.object({
  publish: z.boolean(),
  title_zh: z.string().max(120).default(''),
  title_ja: z.string().max(120).default(''),
  body_zh: z.string().max(800).default(''),
  body_ja: z.string().max(800).default(''),
  importance: z.coerce.number().int().min(1).max(3).default(1),
  effects: z.array(z.object({ ccy, direction: num(-1, 1) })).max(4).default([]),
  risk_sentiment: num(-1, 1).default(0),
});
export type Breaking = z.infer<typeof BreakingSchema>;

export const MacroSchema = z.object({
  regime: z.enum(['normal', 'trend', 'range', 'panic', 'illiquid']),
  risk_sentiment: num(-1, 1),
  horizon_hours: num(1, 24),
  currencies: z.record(z.string(), z.object({ bias: num(-1, 1), volatility: num(0.5, 3) })),
  commentary: z.string().max(600).default(''),
});
export type MacroOut = z.infer<typeof MacroSchema>;

const openAction = z.object({
  type: z.literal('open'),
  sym: z.string(),
  side: z.enum(['buy', 'sell']),
  lots: z.coerce.number().positive(),
  sl_pips: z.coerce.number().positive().nullable().optional(),
  tp_pips: z.coerce.number().positive().nullable().optional(),
  trail_pips: z.coerce.number().positive().nullable().optional(),
  reason: z.string().max(400).default(''),
});
const closeAction = z.object({
  type: z.literal('close'),
  position_id: z.string(),
  lots: z.coerce.number().positive().nullable().optional(),
  reason: z.string().max(400).default(''),
});
const modifyAction = z.object({
  type: z.literal('modify'),
  position_id: z.string(),
  sl_price: z.coerce.number().positive().nullable().optional(),
  tp_price: z.coerce.number().positive().nullable().optional(),
  reason: z.string().max(400).default(''),
});
const holdAction = z.object({ type: z.literal('hold'), reason: z.string().max(400).default('') });

export const TraderSchema = z.object({
  analysis: z.string().max(1500).default(''),
  confidence: num(0, 1).default(0.5),
  actions: z.array(z.discriminatedUnion('type', [openAction, closeAction, modifyAction, holdAction])).max(6),
});
export type TraderOut = z.infer<typeof TraderSchema>;
