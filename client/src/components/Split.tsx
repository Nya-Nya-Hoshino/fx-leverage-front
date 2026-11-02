import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 可拖拽分栏：dir="h" 左右排列，dir="v" 上下排列。
 * 尺寸以比例保存到 localStorage（键 fx.split.<id>），双击分隔条恢复默认。
 */
export default function Split({ id, dir, initial, min, children, className = '' }: {
  id: string; dir: 'h' | 'v'; initial: number[]; min?: number[]; children: ReactNode; className?: string;
}) {
  const kids = Children.toArray(children);
  const key = `fx.split.${id}`;
  const [sizes, setSizes] = useState<number[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      if (Array.isArray(v) && v.length === kids.length && v.every((x) => typeof x === 'number' && x > 0)) return v;
    } catch { /* ignore */ }
    return initial;
  });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; start: number; a: number; b: number; total: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(sizes)); } catch { /* ignore */ }
  }, [sizes, key]);

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d || !box.current) return;
    const pos = dir === 'h' ? e.clientX : e.clientY;
    const sum = d.a + d.b;
    const pxPerUnit = d.total;
    let a = d.a + (pos - d.start) / pxPerUnit;
    const minA = (min?.[d.i] ?? 80) / pxPerUnit, minB = (min?.[d.i + 1] ?? 80) / pxPerUnit;
    a = Math.max(minA, Math.min(sum - minB, a));
    setSizes((s) => { const n = [...s]; n[d.i] = a; n[d.i + 1] = sum - a; return n; });
  }, [dir, min]);

  const onUp = useCallback(() => {
    drag.current = null;
    setActive(null);
    document.body.classList.remove('resizing', 'resizing-h', 'resizing-v');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }, [onMove]);

  const start = (i: number) => (e: React.PointerEvent) => {
    if (!box.current) return;
    e.preventDefault();
    const rect = box.current.getBoundingClientRect();
    const totalPx = (dir === 'h' ? rect.width : rect.height) - (kids.length - 1) * 6;
    const totalUnits = sizes.reduce((x, y) => x + y, 0);
    drag.current = { i, start: dir === 'h' ? e.clientX : e.clientY, a: sizes[i], b: sizes[i + 1], total: totalPx / totalUnits };
    setActive(i);
    document.body.classList.add('resizing', dir === 'h' ? 'resizing-h' : 'resizing-v');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div ref={box} className={`split split-${dir} ${className}`}>
      {kids.map((k, i) => (
        <div key={i} className="split-cell" style={{ display: 'contents' }}>
          <div className="split-pane" style={{ flex: `${sizes[i]} 1 0px`, [dir === 'h' ? 'minWidth' : 'minHeight']: min?.[i] ?? 80 }}>{k}</div>
          {i < kids.length - 1 && (
            <div
              className={`gutter gutter-${dir} ${active === i ? 'active' : ''}`}
              onPointerDown={start(i)}
              onDoubleClick={() => setSizes(initial)}
              role="separator"
              aria-orientation={dir === 'h' ? 'vertical' : 'horizontal'}
            ><span /></div>
          )}
        </div>
      ))}
    </div>
  );
}
