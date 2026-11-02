// 本地模拟 LLM 服务（OpenAI 兼容）：无需真实 API Key 即可体验三个 AI 角色的完整流程。
// 用法：npm run mock-llm  → 在设置里新增配置 Base URL = http://127.0.0.1:8790/v1，模型任意，Key 任意。
// 它只是随机生成结构正确的 JSON，用于联调与演示，不具备任何智能。
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_LLM_PORT ?? 8790);
const CCYS = ['USD', 'JPY', 'EUR', 'GBP', 'CHF', 'AUD', 'NZD', 'CAD', 'CNH', 'HKD', 'TWD', 'KRW', 'SGD'];
const r = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function reply(system: string, user: string): unknown {
  if (system.includes('宏观市场状态决策者')) {
    const currencies = Object.fromEntries(CCYS.map((c) => [c, { bias: +r(-0.5, 0.5).toFixed(2), volatility: +r(0.8, 1.6).toFixed(2) }]));
    return { regime: pick(['normal', 'trend', 'range', 'normal']), risk_sentiment: +r(-0.6, 0.6).toFixed(2), horizon_hours: 4, currencies, commentary: '（模拟）各国数据分化，资金在高息与避险货币间轮动。' };
  }
  if (system.includes('突发新闻编辑')) {
    if (Math.random() < 0.6) return { publish: false };
    const c = pick(['USD', 'JPY', 'EUR', 'GBP', 'AUD']);
    const d = Math.random() < 0.5 ? -1 : 1;
    return {
      publish: true, importance: pick([1, 2, 2, 3]), effects: [{ ccy: c, direction: d * 0.7 }], risk_sentiment: +r(-0.3, 0.3).toFixed(2),
      title_zh: `【模拟快讯】${c} 相关官员发表${d > 0 ? '强硬' : '温和'}讲话`, title_ja: `【模擬速報】${c}関連当局者が${d > 0 ? '強硬' : '穏健'}発言`,
      body_zh: '这是一条由本地模拟 LLM 生成的虚构新闻，用于测试 AI 新闻管线。', body_ja: 'これはローカル模擬LLMが生成した架空ニュースで、AIニュースの動作確認用です。',
    };
  }
  if (system.includes('资深新闻编辑')) {
    const m = user.match(/事件：(.+)\n/);
    return { title_zh: `【AI快讯】${m?.[1] ?? '经济数据'}公布`, title_ja: `【AI速報】${m?.[1] ?? '経済指標'}発表`, body_zh: '（模拟 LLM）数据已公布，市场将重新评估央行政策路径。', body_ja: '（模擬LLM）指標が発表され、市場は中銀の政策見通しを再評価へ。' };
  }
  if (system.includes('交易员 AI')) {
    const pairs = (system.match(/可交易货币对：(.+)。/)?.[1] ?? 'USDJPY').split(',').map((s) => s.trim());
    const ids = [...user.matchAll(/"id":"(p\d+)"[^}]*"source":"ai"/g)].map((m) => m[1]);
    if (ids.length && Math.random() < 0.4) return { analysis: '（模拟）获利了结/止损离场。', confidence: 0.5, actions: [{ type: 'close', position_id: ids[0], reason: '模拟平仓' }] };
    if (Math.random() < 0.5) return { analysis: '（模拟）方向不明，观望。', confidence: 0.4, actions: [{ type: 'hold', reason: '观望' }] };
    return { analysis: '（模拟）动能偏强，小仓位试单。', confidence: 0.6, actions: [{ type: 'open', sym: pick(pairs), side: pick(['buy', 'sell']), lots: 1, sl_pips: 25, tp_pips: 50, reason: '模拟信号' }] };
  }
  return { ok: true, model: 'mock-llm' };
}

createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    try {
      const j = JSON.parse(body || '{}');
      const msgs = j.messages ?? [];
      const system = msgs.find((m: any) => m.role === 'system')?.content ?? j.system ?? '';
      const user = msgs.filter((m: any) => m.role === 'user').map((m: any) => m.content).join('\n');
      const content = JSON.stringify(reply(system, user));
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: Math.round((system.length + user.length) / 2), completion_tokens: Math.round(content.length / 2) } }));
      }, r(200, 900));
    } catch (e) {
      res.writeHead(400);
      res.end(String(e));
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`mock LLM (OpenAI compatible) → http://127.0.0.1:${PORT}/v1`));
