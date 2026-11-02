import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Game } from '../server/core/game';
import { Db } from '../server/db';
import { KeyStore } from '../server/keystore';
import { Runtime } from '../server/runtime';
import { LlmClient, callJson, extractJson, type AiProfile, type FetchLike } from '../server/ai/llm';
import { TraderSchema } from '../server/ai/schemas';
import { executeTrader } from '../server/ai/agents';
import { localDecide } from '../server/ai/localTrader';
import { summarize } from '../server/core/account';
import { newGame } from './helpers';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'fxsim-'));
}

function snapshotEq(a: Game, b: Game) {
  expect(b.t).toBe(a.t);
  for (const s of ['USDJPY', 'EURUSD', 'GBPJPY', 'AUDJPY', 'USDCNH']) {
    expect(b.quotes[s].bid).toBe(a.quotes[s].bid);
    expect(b.quotes[s].ask).toBe(a.quotes[s].ask);
  }
  expect(summarize(b).equity).toBeCloseTo(summarize(a).equity, 9);
  expect(b.candles.bars('USDJPY', '1m', 50)).toEqual(a.candles.bars('USDJPY', '1m', 50));
}

describe('存档恢复', () => {
  it('JSON 序列化后恢复，与不中断运行的结果逐 Tick 完全一致（含随机种子与生成器状态）', () => {
    const a = newGame({ seed: 2024, lev: 500 });
    a.st.marketSettings.jumpRate = 1; // 恢复随机事件
    a.st.marketSettings.blackSwanPerYear = 20;
    a.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 50000, sl: a.quotes.USDJPY.bid - 1, source: 'player' });
    a.order({ sym: 'EURUSD', side: 'sell', type: 'limit', price: a.quotes.EURUSD.bid + 0.002, units: 20000, source: 'player' });
    a.borrow(300000, 'consumer');
    a.simulate(6 * 3600, 4);
    const json = JSON.stringify(a.serialize());
    const closed = Object.entries(a.candles.data).flatMap(([sym, s]) => Object.entries(s).flatMap(([tf, x]) => x.closed.map((c) => ({ sym, tf: tf as any, c: { ...c } }))));
    const b = Game.restore(JSON.parse(json), closed);
    snapshotEq(a, b);
    a.simulate(3 * 86400, 4);
    b.simulate(3 * 86400, 4);
    snapshotEq(a, b);
    expect(JSON.stringify(b.serialize().loans)).toBe(JSON.stringify(a.serialize().loans));
    expect(b.st.economy.calendar.map((e) => e.actual)).toEqual(a.st.economy.calendar.map((e) => e.actual));
  });

  it('SQLite：写入 → 新运行时读取 → 继续游戏；多存档互不串号', async () => {
    const dir = tmp();
    const db = new Db(join(dir, 'x.db'));
    const keys = new KeyStore(join(dir, '.k'));
    const rt = new Runtime(db, keys);
    const g1 = await rt.create({ name: 'A', username: 'alice', accountCcy: 'JPY', maxLeverage: 100, seed: 1, preRollDays: 1 });
    g1.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 10000, source: 'player' });
    g1.simulate(3600, 4);
    const id1 = g1.st.saveId;
    const eq1 = summarize(g1).equity;
    const t1 = g1.t;
    const g2 = await rt.create({ name: 'B', username: 'bob', accountCcy: 'CNY', maxLeverage: 3000, seed: 2, preRollDays: 1 });
    const id2 = g2.st.saveId;
    expect(id2).not.toBe(id1);
    g2.borrow(1000, 'bank');
    await rt.unload();
    expect(db.listSaves().length).toBe(2);

    const rt2 = new Runtime(db, keys);
    const r1 = await rt2.load(id1);
    expect(r1.st.account.username).toBe('alice');
    expect(r1.t).toBe(t1);
    expect(summarize(r1).equity).toBeCloseTo(eq1, 6);
    expect(r1.st.positions.length).toBe(1);
    expect(r1.st.loans.length).toBe(0);
    expect(r1.candles.bars('USDJPY', '1m', 3000).length).toBe(g1.candles.bars('USDJPY', '1m', 3000).length);
    r1.simulate(600, 4);
    const r2 = await rt2.load(id2);
    expect(r2.st.account.username).toBe('bob');
    expect(r2.st.account.ccy).toBe('CNY');
    expect(r2.st.loans.length).toBe(1);
    expect(r2.st.positions.length).toBe(0);
    rt2.shutdown();
    db.close();
  });

  it('API Key 加密存储、只返回掩码', () => {
    const dir = tmp();
    const db = new Db(join(dir, 'x.db'));
    const keys = new KeyStore(join(dir, '.k'));
    const rt = new Runtime(db, keys);
    const id = rt.saveProfile({ name: 'p', provider: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: 'sk-test-1234567890abcdef', model: 'm', maxTokens: 100, timeoutMs: 1000, jsonMode: true, priceIn: 0, priceOut: 0, minIntervalMs: 0, maxRetries: 0 });
    const row = db.listProfiles()[0];
    expect(row.api_key_enc).not.toContain('1234567890');
    const pub = rt.profilesPublic()[0] as any;
    expect(pub.apiKey).toBeUndefined();
    expect(pub.keyHint).toBe('sk-****cdef');
    expect(rt.getProfile(id)!.apiKey).toBe('sk-test-1234567890abcdef');
    db.close();
  });
});

const PROFILE: AiProfile = {
  id: 'p1', name: 'mock', provider: 'openai', baseUrl: 'http://mock/v1', apiKey: 'sk-secret-key-abcdef123456', model: 'mock-model',
  maxTokens: 500, timeoutMs: 2000, jsonMode: true, priceIn: 1, priceOut: 2, minIntervalMs: 0, maxRetries: 2,
};

function okResponse(content: string) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }) };
}

describe('AI 客户端：重试、超时、校验、降级', () => {
  it('5xx 后重试成功；统计 token', async () => {
    let n = 0;
    const f: FetchLike = async () => (++n < 3 ? { ok: false, status: 503, text: async () => 'busy' } : okResponse('{"ok":true}'));
    const c = new LlmClient(f);
    const r = await c.chat({ ...PROFILE }, 's', 'u', 0);
    expect(n).toBe(3);
    expect(r.tokensIn).toBe(100);
  });

  it('401 不重试，错误信息中密钥被脱敏', async () => {
    let n = 0;
    const f: FetchLike = async () => { n++; return { ok: false, status: 401, text: async () => `invalid key ${PROFILE.apiKey}` }; };
    const c = new LlmClient(f);
    await expect(c.chat(PROFILE, 's', 'u', 0)).rejects.toThrow(/HTTP 401/);
    await c.chat(PROFILE, 's', 'u', 0).catch((e) => expect(String(e.message)).not.toContain('abcdef123456'));
    expect(n).toBe(2);
  });

  it('超时', async () => {
    const f: FetchLike = (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    const c = new LlmClient(f);
    await expect(c.chat({ ...PROFILE, timeoutMs: 50, maxRetries: 0 }, 's', 'u', 0)).rejects.toThrow(/超时/);
  });

  it('JSON Schema 校验失败时反馈重试；从 Markdown 代码块中提取 JSON', async () => {
    expect(extractJson('blah ```json\n{"a":{"b":"}"}}\n``` tail')).toEqual({ a: { b: '}' } });
    let n = 0;
    const f: FetchLike = async () => (++n === 1 ? okResponse('{"analysis":"x","actions":[{"type":"fly"}]}') : okResponse('{"analysis":"ok","confidence":0.7,"actions":[{"type":"hold","reason":"wait"}]}'));
    const r = await callJson(new LlmClient(f), PROFILE, 's', 'u', TraderSchema, 0);
    expect(r.attempts).toBe(2);
    expect(r.data.actions[0].type).toBe('hold');
  });

  it('Anthropic 协议请求格式与响应解析', async () => {
    let seen: any;
    const f: FetchLike = async (url, init) => {
      seen = { url, headers: init.headers, body: JSON.parse(init.body) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"x":1}' }], usage: { input_tokens: 7, output_tokens: 3 } }) };
    };
    const r = await new LlmClient(f).chat({ ...PROFILE, provider: 'anthropic', baseUrl: 'https://api.anthropic.com' }, 'sys', 'hi', 0.2);
    expect(seen.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen.headers['x-api-key']).toBe(PROFILE.apiKey);
    expect(seen.headers['anthropic-version']).toBe('2023-06-01');
    expect(seen.body.system).toBe('sys');
    expect(r.text).toBe('{"x":1}');
    expect(r.tokensOut).toBe(3);
  });

  it('AI 交易员调用失败 → 记录失败并降级为本地策略，行情继续运行', async () => {
    const dir = tmp();
    const db = new Db(join(dir, 'x.db'));
    const rt = new Runtime(db, new KeyStore(join(dir, '.k')), new LlmClient(async () => ({ ok: false, status: 500, text: async () => 'down' })));
    const g = await rt.create({ name: 'A', username: 'a', accountCcy: 'JPY', maxLeverage: 100, seed: 3, preRollDays: 2 });
    const pid = rt.saveProfile({ name: 'bad', provider: 'openai', baseUrl: 'http://mock/v1', apiKey: 'k', model: 'm', maxTokens: 100, timeoutMs: 1000, jsonMode: true, priceIn: 0, priceOut: 0, minIntervalMs: 0, maxRetries: 0 });
    g.st.ai.roles.trader = { enabled: true, profileId: pid, intervalSec: 10, temperature: 0 };
    g.st.autoTrader.enabled = true;
    const t0 = g.t;
    await rt.runTrader(true);
    const logs = g.st.aiLog.filter((l) => l.role === 'trader');
    expect(logs.some((l) => l.engine === 'ai' && !l.ok)).toBe(true);
    expect(logs.some((l) => l.engine === 'local')).toBe(true);
    expect(g.st.ai.usage.trader.fails).toBe(1);
    g.simulate(60, 4);
    expect(g.t).toBe(t0 + 60);
    rt.shutdown();
    db.close();
  });

  it('AI 交易员成功调用 → 订单经同一风控执行；超仓被拒绝', async () => {
    const dir = tmp();
    const db = new Db(join(dir, 'x.db'));
    const content = JSON.stringify({
      analysis: 'test', confidence: 0.8, actions: [
        { type: 'open', sym: 'USDJPY', side: 'buy', lots: 1, sl_pips: 20, tp_pips: 40, reason: 'r' },
        { type: 'open', sym: 'EURUSD', side: 'sell', lots: 5000, sl_pips: 20, reason: 'way too big' },
        { type: 'open', sym: 'USDTWD', side: 'sell', lots: 1, sl_pips: 20, reason: 'not allowed pair' },
      ],
    });
    const rt = new Runtime(db, new KeyStore(join(dir, '.k')), new LlmClient(async () => okResponse(content)));
    const g = await rt.create({ name: 'A', username: 'a', accountCcy: 'JPY', maxLeverage: 25, seed: 4, preRollDays: 1 });
    const pid = rt.saveProfile({ name: 'ok', provider: 'openai', baseUrl: 'http://mock/v1', apiKey: 'k', model: 'm', maxTokens: 100, timeoutMs: 1000, jsonMode: true, priceIn: 1, priceOut: 2, minIntervalMs: 0, maxRetries: 0 });
    g.st.ai.roles.trader = { enabled: true, profileId: pid, intervalSec: 10, temperature: 0 };
    g.st.autoTrader.maxLotsPerOrder = 10000;
    g.st.autoTrader.maxEffectiveLeverage = 1e9;
    await rt.runTrader(true);
    const log = g.st.aiLog.at(-1)!;
    expect(log.engine).toBe('ai');
    expect(log.actions!.map((a) => a.ok)).toEqual([true, false, false]);
    expect(g.st.positions.length).toBe(1);
    expect(g.st.positions[0].source).toBe('ai');
    expect(g.st.positions[0].sl).not.toBeNull();
    expect(g.st.ai.usage.trader.cost).toBeCloseTo((100 * 1 + 50 * 2) / 1e6, 12);
    rt.shutdown();
    db.close();
  });

  it('本地规则交易员可以离线运行并产生合法决策', () => {
    const g = newGame({ days: 3, lev: 100 });
    for (const s of ['trend', 'meanrev', 'breakout', 'gambler'] as const) {
      g.st.autoTrader.strategy = s;
      const out = localDecide(g);
      expect(TraderSchema.safeParse(out).success).toBe(true);
      executeTrader(g, out);
    }
  });
});
