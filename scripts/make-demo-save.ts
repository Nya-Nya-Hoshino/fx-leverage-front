// 生成演示存档：npm run demo
// 创建一个 JPY 账户（1000 倍）：已有持仓、挂单、一笔贷款，并开启本地 AI 交易员，模拟运行半天。
import { join, resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Db } from '../server/db';
import { KeyStore } from '../server/keystore';
import { Runtime } from '../server/runtime';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.FXSIM_DATA ?? join(ROOT, 'data');
mkdirSync(DATA, { recursive: true });

const db = new Db(join(DATA, 'fxsim.db'));
const rt = new Runtime(db, new KeyStore(join(DATA, '.secret.key')));

const g = await rt.create({ name: '演示存档 Demo', username: 'くるみ候补生', accountCcy: 'JPY', maxLeverage: 1000, seed: 20310106 });
g.simulate(2 * 3600, 4);
const q = g.quotes;
g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 200_000, sl: q.USDJPY.bid - 0.6, tp: q.USDJPY.ask + 1.2, source: 'player' });
g.order({ sym: 'GBPJPY', side: 'sell', type: 'market', units: 50_000, trailPips: 30, source: 'player' });
g.order({ sym: 'EURUSD', side: 'buy', type: 'limit', price: Math.round((q.EURUSD.bid - 0.002) * 1e5) / 1e5, units: 100_000, source: 'player' });
g.borrow(500_000, 'consumer');
g.st.autoTrader.enabled = true;
g.st.autoTrader.strategy = 'trend';
g.st.autoTrader.risk = 'aggressive';
for (let i = 0; i < 12; i++) {
  g.simulate(1800, 4);
  await rt.runTrader(true);
}
g.st.clock.paused = true;
rt.persist();
const s = g.summary();
console.log(`演示存档已创建：${g.st.name}（${g.st.saveId}）`);
console.log(`模拟时间 ${new Date(g.t * 1000).toISOString()}，净值 ${Math.round(s.equity)} JPY，持仓 ${g.st.positions.length}，贷款 ${Math.round(s.loanDebt)} JPY`);
rt.shutdown();
db.close();
process.exit(0);
