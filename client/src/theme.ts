// 主题：跟随系统（浅色/深色）、浅色、深色（商务石墨）、经典深蓝紫。
import { useS, type ThemePref } from './store';

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function resolveTheme(pref: ThemePref): 'light' | 'dark' | 'navy' {
  if (pref === 'system') return mq?.matches ? 'dark' : 'light';
  return pref;
}

export function applyTheme(pref: ThemePref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
  try { localStorage.setItem('fx.theme', pref); } catch { /* ignore */ }
  useS.setState((s) => ({ theme: pref, themeRev: s.themeRev + 1 }));
}

export function initTheme() {
  applyTheme(useS.getState().theme);
  mq?.addEventListener('change', () => { if (useS.getState().theme === 'system') applyTheme('system'); });
}

/** 读取当前主题的 CSS 变量（图表等 Canvas 组件使用） */
export function cssVar(name: string, fallback = '#888'): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 把 #rrggbb 转为带透明度的 rgba */
export function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const SERIES_COLORS = ['#5b8def', '#e0a43a', '#2fb67c', '#b06ad9', '#e5484d', '#3fb8c4', '#8e9aaf', '#d9734e'];
