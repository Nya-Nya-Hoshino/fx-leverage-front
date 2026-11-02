// 构建安卓横屏 App：npm run dist:android [-- --release]
// 需要：JDK 21（JAVA_HOME）与 Android SDK（ANDROID_HOME，含 platforms;android-36）。
// 1) 以离线模式构建前端（游戏引擎运行在 WebView 内） → 2) cap sync → 3) Gradle 打包 APK → 复制到 release/
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv.includes('--release');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const run = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env });

if (!process.env.JAVA_HOME) console.warn('[!] 未设置 JAVA_HOME（需要 JDK 21）');
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const lp = join(ROOT, 'android', 'local.properties');
if (sdk && !existsSync(lp)) writeFileSync(lp, `sdk.dir=${sdk.replace(/\\/g, '/').replace(':', '\\:')}\n`);
if (!sdk && !existsSync(lp)) console.warn('[!] 未设置 ANDROID_HOME，且 android/local.properties 不存在');

run('npx vite build --mode standalone');
run('npx cap sync android');
const gradlew = JSON.stringify(join(ROOT, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'));
run(`${gradlew} ${release ? 'assembleRelease' : 'assembleDebug'} --no-daemon`, join(ROOT, 'android'));

const kind = release ? 'release' : 'debug';
const src = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', kind, `app-${kind}.apk`);
mkdirSync(join(ROOT, 'release'), { recursive: true });
const dst = join(ROOT, 'release', `FX-Leverage-Front-${pkg.version}-${kind}.apk`);
cpSync(src, dst);
console.log(`\nAPK → ${dst}`);
