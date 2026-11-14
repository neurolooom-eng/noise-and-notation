import { useId, useRef, useState, type ReactNode } from 'react';

/**
 * Chart defaults (validated palette in styles.css → "Charts").
 *  - StatTile / KpiRow   headline numbers (not charts)
 *  - LikertChart         diverging stacked bars centred on Neutral (agree ↔ disagree)
 *  - LineChart           one series over sessions, crosshair + tooltip
 *  - ChartCard           title, subtitle, legend slot, and a "Table view" toggle
 * Marks: bars ≤ 20px, 4px rounded data-ends, 2px surface gaps; 2px lines; ≥8px markers
 * with a 2px surface ring. Text never uses series colours. Every chart has a table view.
 */

// ------------------------------------------------------------------ tooltip
interface Tip { x: number; y: number; value: string; label: string }

function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (el: Element, value: string, label: string) => {
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, value, label });
  };
  const node = tip ? (
    <div className="viz-tooltip" role="status" style={{ left: tip.x, top: tip.y }}>
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  ) : null;
  return { show, hide: () => setTip(null), node };
}

// ------------------------------------------------------------------ stat tiles
export function StatTile({ label, value, sub, status }: {
  label: string; value: ReactNode; sub?: ReactNode;
  status?: { tone: 'good' | 'warning' | 'critical'; text: string };
}) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {status && (
        <div className={`status-chip ${status.tone}`}>
          <span aria-hidden="true">{status.tone === 'good' ? '▲' : status.tone === 'warning' ? '●' : '▼'}</span> {status.text}
        </div>
      )}
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="kpi-row">{children}</div>;
}

// ------------------------------------------------------------------ chart card + table view
export interface TableView { columns: string[]; rows: (string | number)[][] }

export function ChartCard({ title, subtitle, legend, table, children, note }: {
  title: string; subtitle?: ReactNode; legend?: ReactNode; table: TableView; children: ReactNode; note?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <section className="chart-card" aria-labelledby={`${id}-t`}>
      <header className="chart-head">
        <div>
          <h3 id={`${id}-t`}>{title}</h3>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        <button type="button" className="btn small-btn" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show chart' : 'Table view'}
        </button>
      </header>
      {!asTable && legend}
      {asTable ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}
              {!table.rows.length && <tr><td colSpan={table.columns.length} className="muted">No data.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : children}
      {note && <p className="muted small chart-note">{note}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ Likert (diverging stacked)
export const LIKERT_LABELS = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

export function LikertLegend() {
  return (
    <ul className="viz-legend" aria-label="Legend">
      {LIKERT_LABELS.map((l, i) => (
        <li key={l}><span className={`swatch likert-${i + 1}`} aria-hidden="true" />{l}</li>
      ))}
    </ul>
  );
}

export interface LikertItem {
  key: string;
  label: string;
  title?: string;
  /** counts for ratings 1..5 */
  counts: [number, number, number, number, number];
  mean: number | null;
  /** false => below the minimum number of answers: no bar is drawn */
  visible: boolean;
  needMore?: number;
}

export function LikertChart({ items }: { items: LikertItem[] }) {
  const tip = useTooltip();
  return (
    <div className="likert" onPointerLeave={tip.hide}>
      <div className="likert-axis" aria-hidden="true">
        <span>100% disagree</span><span>0</span><span>100% agree</span>
      </div>
      {items.map((it) => {
        const n = it.counts.reduce((a, b) => a + b, 0);
        const pct = it.counts.map((c) => (n ? (c / n) * 100 : 0));
        // Left of centre: neutral/2, disagree, strongly disagree. Right: neutral/2, agree, strongly agree.
        const halfNeutral = pct[2] / 2;
        const segs = [
          { i: 0, side: 'left', start: halfNeutral + pct[1], w: pct[0] },
          { i: 1, side: 'left', start: halfNeutral, w: pct[1] },
          { i: 2, side: 'left', start: 0, w: halfNeutral, neutralHalf: true },
          { i: 2, side: 'right', start: 0, w: halfNeutral, neutralHalf: true },
          { i: 3, side: 'right', start: halfNeutral, w: pct[3] },
          { i: 4, side: 'right', start: halfNeutral + pct[3], w: pct[4] },
        ];
        // the outermost non-empty segment on each side gets the rounded data-end
        const outerLeft = pct[0] > 0 ? 0 : pct[1] > 0 ? 1 : 2;
        const outerRight = pct[4] > 0 ? 4 : pct[3] > 0 ? 3 : 2;
        const agree = pct[3] + pct[4], disagree = pct[0] + pct[1];
        return (
          <div className="likert-row" key={it.key}>
            <div className="likert-label" title={it.title}>
              <strong>{it.label}</strong>
              {it.title && <span className="muted small likert-statement">{it.title}</span>}
            </div>
            {it.visible ? (
              <div className="likert-bar" role="img"
                aria-label={`${it.label}: ${Math.round(agree)}% agree, ${Math.round(pct[2])}% neutral, ${Math.round(disagree)}% disagree, ${n} answers`}>
                <span className="likert-centre" aria-hidden="true" />
                {segs.filter((s) => s.w > 0).map((s, k) => {
                  const rounded = s.side === 'left' ? s.i === outerLeft : s.i === outerRight;
                  const style = s.side === 'left'
                    ? { right: `${50 + s.start / 2}%`, width: `${s.w / 2}%` }
                    : { left: `${50 + s.start / 2}%`, width: `${s.w / 2}%` };
                  const value = `${it.counts[s.i]} (${Math.round(pct[s.i])}%)`;
                  return (
                    <span
                      key={k}
                      className={`likert-seg likert-${s.i + 1} ${s.side} ${rounded ? 'end' : ''}`}
                      style={style}
                      tabIndex={s.neutralHalf && s.side === 'right' ? -1 : 0}
                      aria-label={`${LIKERT_LABELS[s.i]}: ${value}`}
                      onPointerEnter={(e) => tip.show(e.currentTarget, value, `${LIKERT_LABELS[s.i]} · ${it.label}`)}
                      onFocus={(e) => tip.show(e.currentTarget, value, `${LIKERT_LABELS[s.i]} · ${it.label}`)}
                      onBlur={tip.hide}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="likert-hidden muted small">
                Hidden — needs {it.needMore} more answer{it.needMore === 1 ? '' : 's'} (small-group protection)
              </div>
            )}
            <div className="likert-value">
              {it.visible && it.mean != null ? (<><strong>{it.mean.toFixed(2)}</strong><span className="muted small"> avg · {Math.round(agree)}% agree</span></>) : <span className="muted small">n = {n}</span>}
            </div>
          </div>
        );
      })}
      {tip.node}
    </div>
  );
}

// ------------------------------------------------------------------ line chart
export interface LinePoint { label: string; detail: string; y: number | null }

export function LineChart({ points, yMin = 1, yMax = 5, valueLabel = 'Average' }: {
  points: LinePoint[]; yMin?: number; yMax?: number; valueLabel?: string;
}) {
  const W = 640, H = 240, M = { t: 16, r: 56, b: 36, l: 40 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const x = (i: number) => M.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => M.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const ticks = Array.from({ length: yMax - yMin + 1 }, (_, i) => yMin + i);

  // Path with gaps where a point is hidden (below minimum answers).
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.y == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)} `;
    pen = true;
  });
  const lastIdx = [...points.keys()].reverse().find((i) => points[i].y != null);

  const onMove = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg || !points.length) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  };
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="linechart">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${valueLabel} by session: ${points.map((p) => `${p.label} ${p.y == null ? 'hidden' : p.y.toFixed(2)}`).join(', ')}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (!points.length) return;
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const d = e.key === 'ArrowRight' ? 1 : -1;
            setHover((h) => Math.min(points.length - 1, Math.max(0, (h ?? (d > 0 ? -1 : points.length)) + d)));
          }
        }}
        onFocus={() => setHover((h) => h ?? points.length - 1)}
        onBlur={() => setHover(null)}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="viz-grid" x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
            <text className="viz-tick" x={M.l - 10} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
          </g>
        ))}
        <line className="viz-axis" x1={M.l} x2={W - M.r} y1={M.t + ih} y2={M.t + ih} />
        {points.map((p, i) => (
          <text key={i} className="viz-tick" x={x(i)} y={H - 12} textAnchor="middle">{p.label}</text>
        ))}
        {hp && <line className="viz-crosshair" x1={x(hover!)} x2={x(hover!)} y1={M.t} y2={M.t + ih} />}
        <path className="viz-line" d={d} />
        {points.map((p, i) => p.y == null ? null : (
          <circle key={i} className="viz-dot" cx={x(i)} cy={y(p.y)} r={hover === i ? 6 : 4.5} />
        ))}
        {lastIdx != null && points[lastIdx].y != null && (
          <text className="viz-endlabel" x={x(lastIdx) + 10} y={y(points[lastIdx].y!)} dy="0.32em">
            {points[lastIdx].y!.toFixed(2)}
          </text>
        )}
      </svg>
      {hp && (
        <div className="viz-tooltip static" role="status" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <strong>{hp.y == null ? 'Hidden' : hp.y.toFixed(2)}</strong>
          <span>{hp.detail}</span>
        </div>
      )}
    </div>
  );
}
