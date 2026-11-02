// 启动器：让 Node 内置 fetch 遵循 HTTP(S)_PROXY / NO_PROXY 环境变量（NODE_USE_ENV_PROXY=1），
// 否则在需要代理的网络环境中访问 AI API 会连接超时。随后以 tsx 运行服务端。
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const args = ['--import', 'tsx', ...(watch ? ['--watch'] : []), join(root, 'server', 'index.ts')];
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1' },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
