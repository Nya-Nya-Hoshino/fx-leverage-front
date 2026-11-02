// Electron 主进程：在本进程内启动游戏服务端（SQLite 存档），并用应用窗口加载界面。
import { app, BrowserWindow, Menu, dialog, net, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PREFERRED_PORT = 18787; // 固定端口使界面偏好（语言/图表设置）在重启后保留；被占用时改用随机端口

if (!app.requestSingleInstanceLock()) app.quit();

let srv = null;
let win = null;

async function boot() {
  const { startServer } = await import('./server.mjs');
  const dataDir = join(app.getPath('userData'), 'data');
  const opts = {
    dataDir,
    distDir: join(here, 'web'),
    host: '127.0.0.1',
    aiConfigFile: join(dataDir, 'ai.local.json'),
    // Chromium 网络栈：自动遵循系统代理设置
    fetchImpl: (url, init) => net.fetch(url, init),
    log: (m) => console.log(m),
  };
  try {
    srv = await startServer({ ...opts, port: PREFERRED_PORT });
  } catch {
    srv = await startServer({ ...opts, port: 0 });
  }

  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1600, height: 950, minWidth: 1024, minHeight: 640,
    backgroundColor: '#070c18',
    title: '杠杆战线 FX Leverage Front',
    icon: join(here, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(srv.url)) e.preventDefault(); });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  await win.loadURL(srv.url);
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(boot).catch((e) => {
  dialog.showErrorBox('启动失败 / 起動失敗', String(e?.stack ?? e));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { srv?.shutdown(); } catch { /* ignore */ } });
