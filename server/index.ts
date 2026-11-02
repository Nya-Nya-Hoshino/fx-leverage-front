// 命令行入口：npm start。默认只监听 127.0.0.1。
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(ROOT, 'dist');

const srv = await startServer({
  dataDir: process.env.FXSIM_DATA ?? join(ROOT, 'data'),
  distDir: dist,
  port: Number(process.env.FXSIM_PORT ?? 8787),
  host: process.env.FXSIM_HOST ?? '127.0.0.1',
  aiConfigFile: join(ROOT, 'config', 'ai.local.json'),
  demo: process.env.FXSIM_DEMO === '1',
});
console.log(`\n  杠杆战线 FX Leverage Front 服务已启动： ${srv.url}`);
console.log(`  数据目录：${process.env.FXSIM_DATA ?? join(ROOT, 'data')}`);
if (!existsSync(dist)) console.log('  （未找到 dist，开发模式请访问 Vite 地址 http://127.0.0.1:5173）');

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  console.log('\n正在保存并退出……');
  srv.shutdown();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
