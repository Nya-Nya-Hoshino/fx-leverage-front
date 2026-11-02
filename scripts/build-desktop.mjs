// 打包桌面版：npm run dist:desktop
//  1) 构建前端 → 2) esbuild 打包服务端为单文件 → 3) 组装 Electron 应用目录 → 4) electron-builder 生成安装包与免安装版
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'build', 'desktop-app');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

run('node scripts/make-icons.mjs');
run('npx vite build');

rmSync(APP, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });
await build({
  entryPoints: [join(ROOT, 'server', 'app.ts')],
  outfile: join(APP, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['bufferutil', 'utf-8-validate', 'electron'],
  // express 等 CJS 依赖在 ESM 包中需要 require
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
cpSync(join(ROOT, 'desktop', 'main.mjs'), join(APP, 'main.mjs'));
cpSync(join(ROOT, 'dist'), join(APP, 'web'), { recursive: true });
cpSync(join(ROOT, 'build', 'icons', 'icon.png'), join(APP, 'icon.png'));
writeFileSync(join(APP, 'package.json'), JSON.stringify({
  name: 'fx-leverage-front', productName: 'FX Leverage Front', version: pkg.version, description: pkg.description,
  author: 'FX Leverage Front', main: 'main.mjs', type: 'module',
}, null, 2));

run('npx electron-builder --win --config electron-builder.json');
