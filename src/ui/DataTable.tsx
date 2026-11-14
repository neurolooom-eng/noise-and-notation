import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { exportCsv, exportExcel, type CellValue } from './exporters';
import type { TableLayout, ViewStore } from './useSavedViews';

/**
 * DataTable — the default table for the app.
 *
 *  1. Adjustable width   — drag a header's right edge (or focus it and use ← →; double-click resets)
 *  2. Rearrange columns  — drag a header onto another (or use ↑ ↓ in the Columns panel)
 *  3. Export             — CSV or Excel of exactly what is shown (visible columns, current order & sort)
 *  4. Choose columns     — Columns panel; save the layout as a named view
 *  5. Density            — Comfortable / Compact
 *  + click a header to sort.
 *
 * The working layout is remembered on this device; named views are saved to the
 * account (via the optional `viewStore`).
 */

export interface Column<T> {
  id: string;
  header: string;
  /** Long description shown as the header tooltip (e.g. a question's full statement). */
  title?: string;
  /** Raw value: used for sorting and export. */
  value: (row: T) => CellValue;
  /** Optional custom cell rendering (defaults to the formatted value). */
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number;
  minWidth?: number;
  hiddenByDefault?: boolean;
  /** Excel column width in characters. */
  exportWidth?: number;
}

interface Props<T> {
  tableKey: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  exportName: string;
  caption?: string;
  emptyText?: string;
  viewStore?: ViewStore;
  toolbarExtra?: ReactNode;
  /** Optional detail row under a row (e.g. a question's history). */
  expandedKey?: string | number | null;
  renderExpanded?: (row: T) => ReactNode;
  /** Optional class per row (e.g. 'inactive-row'). */
  rowClassName?: (row: T) => string;
}

const MIN_W = 64;
const LS_PREFIX = 'nn-table-layout:';

function defaultLayout<T>(columns: Column<T>[]): TableLayout {
  return {
    order: columns.map((c) => c.id),
    hidden: columns.filter((c) => c.hiddenByDefault).map((c) => c.id),
    widths: {},
    density: 'comfortable',
    sort: null,
  };
}

/** Merge a stored layout with the current columns (new columns appear, removed ones drop out). */
function reconcile<T>(layout: Partial<TableLayout> | null, columns: Column<T>[]): TableLayout {
  const base = defaultLayout(columns);
  if (!layout) return base;
  const ids = new Set(columns.map((c) => c.id));
  const order = (layout.order ?? []).filter((id) => ids.has(id));
  for (const c of columns) if (!order.includes(c.id)) order.push(c.id);
  const known = new Set(layout.order ?? []);
  const hidden = [
    ...(layout.hidden ?? []).filter((id) => ids.has(id)),
    ...columns.filter((c) => c.hiddenByDefault && !known.has(c.id)).map((c) => c.id),
  ];
  return {
    order,
    hidden,
    widths: layout.widths ?? {},
    density: layout.density === 'compact' ? 'compact' : 'comfortable',
    sort: layout.sort && ids.has(layout.sort.id) ? layout.sort : null,
  };
}

function readLocal(key: string): Partial<TableLayout> | null {
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function formatValue(v: CellValue): ReactNode {
  if (v == null || v === '') return <span className="dt-empty">—</span>;
  if (v instanceof Date) return v.toLocaleString();
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v;
}

function compare(a: CellValue, b: CellValue): number {
  if (a == null || a === '') return b == null || b === '' ? 0 : 1; // empties last
  if (b == null || b === '') return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export default function DataTable<T>({
  tableKey, columns, rows, rowKey, exportName, caption, emptyText = 'No rows.', viewStore, toolbarExtra,
  expandedKey, renderExpanded, rowClassName,
}: Props<T>) {
  const [layout, setLayout] = useState<TableLayout>(() => reconcile(readLocal(tableKey), columns));
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeView, setActiveView] = useState<string>('');
  const [viewName, setViewName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Keep layout valid when the column set changes (e.g. a new question version appears).
  const colKey = columns.map((c) => c.id).join('|');
  useEffect(() => {
    setLayout((l) => reconcile(l, columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colKey]);

  // Remember the working layout on this device.
  useEffect(() => {
    try {
      localStorage.setItem(LS_PREFIX + tableKey, JSON.stringify(layout));
    } catch {
      /* storage unavailable */
    }
  }, [layout, tableKey]);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 3000);
  };

  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const visible = layout.order.filter((id) => !layout.hidden.includes(id)).map((id) => byId.get(id)!).filter(Boolean);

  const sorted = useMemo(() => {
    if (!layout.sort) return rows;
    const col = byId.get(layout.sort.id);
    if (!col) return rows;
    const dir = layout.sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      const emptyA = va == null || va === '', emptyB = vb == null || vb === '';
      if (emptyA || emptyB) return compare(va, vb); // empties always last
      return compare(va, vb) * dir;
    });
  }, [rows, layout.sort, byId]);

  const widthOf = (c: Column<T>) => layout.widths[c.id] ?? c.width ?? 160;
  const update = (patch: Partial<TableLayout>) => {
    setLayout((l) => ({ ...l, ...patch }));
    setActiveView('');
  };

  // ---- sorting
  const toggleSort = (id: string) => {
    const s = layout.sort;
    update({ sort: !s || s.id !== id ? { id, dir: 'asc' } : s.dir === 'asc' ? { id, dir: 'desc' } : null });
  };

  // ---- resizing
  const startResize = (e: React.PointerEvent, c: Column<T>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(c);
    const min = c.minWidth ?? MIN_W;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const w = Math.max(min, Math.round(startW + ev.clientX - startX));
      setLayout((l) => ({ ...l, widths: { ...l.widths, [c.id]: w } }));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      setActiveView('');
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const resizeKey = (e: React.KeyboardEvent, c: Column<T>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const w = Math.max(c.minWidth ?? MIN_W, widthOf(c) + (e.key === 'ArrowRight' ? step : -step));
      update({ widths: { ...layout.widths, [c.id]: w } });
    }
  };
  const resetWidth = (c: Column<T>) => {
    const { [c.id]: _drop, ...rest } = layout.widths;
    void _drop;
    update({ widths: rest });
  };

  // ---- reordering
  const move = (id: string, to: string) => {
    if (id === to) return;
    const order = layout.order.filter((x) => x !== id);
    order.splice(order.indexOf(to), 0, id);
    update({ order });
  };
  const nudge = (id: string, dir: -1 | 1) => {
    const order = [...layout.order];
    const i = order.indexOf(id), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    update({ order });
  };

  // ---- columns & views
  const toggleHidden = (id: string) => {
    const hidden = layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id];
    if (hidden.length >= columns.length) return flash('At least one column must stay visible.');
    update({ hidden });
  };
  const applyView = (idStr: string) => {
    if (!idStr) return;
    if (idStr === '__default') {
      setLayout(defaultLayout(columns));
      setActiveView('');
      return flash('Reset to the default layout.');
    }
    const v = viewStore?.views.find((x) => String(x.id) === idStr);
    if (!v) return;
    setLayout(reconcile(v.config, columns));
    setActiveView(idStr);
    setViewName(v.name);
    flash(`Applied view “${v.name}”.`);
  };
  const saveView = async () => {
    if (!viewStore) return;
    const name = viewName.trim();
    if (!name) return flash('Give the view a name first.');
    const v = await viewStore.save(name, layout);
    if (v) {
      setActiveView(String(v.id));
      flash(`Saved view “${v.name}”.`);
    }
  };
  const deleteView = async () => {
    const v = viewStore?.views.find((x) => String(x.id) === activeView);
    if (!v || !viewStore || !confirm(`Delete the saved view “${v.name}”?`)) return;
    await viewStore.remove(v.id);
    setActiveView('');
    setViewName('');
    flash(`Deleted view “${v.name}”.`);
  };

  // ---- export (exactly what is shown)
  const doExport = async (kind: 'csv' | 'xlsx') => {
    const cols = visible.map((c) => ({ header: c.header, width: c.exportWidth ?? Math.max(10, Math.round(widthOf(c) / 7)) }));
    const data = sorted.map((r) => visible.map((c) => c.value(r)));
    try {
      setExporting(true);
      if (kind === 'csv') exportCsv(exportName, cols, data);
      else await exportExcel(exportName, cols, data);
      flash(`Exported ${data.length} row${data.length === 1 ? '' : 's'} × ${cols.length} column${cols.length === 1 ? '' : 's'}.`);
    } catch (e) {
      flash(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setExporting(false);
    }
  };

  // close the panel on Escape / outside click
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanelOpen(false);
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [panelOpen]);

  const totalWidth = visible.reduce((s, c) => s + widthOf(c), 0);
  const panelId = `dt-panel-${tableKey}`;

  return (
    <div className={`dt dt-${layout.density}`}>
      <div className="dt-toolbar">
        <div className="dt-toolbar-group">
          <div className="dt-panel-anchor" ref={panelRef}>
            <button type="button" className="btn small-btn" aria-expanded={panelOpen} aria-controls={panelId}
              onClick={() => setPanelOpen((o) => !o)}>
              ☰ Columns & views
            </button>
            {panelOpen && (
              <div className="dt-panel" id={panelId} role="dialog" aria-label="Columns and saved views">
                <h4>Columns</h4>
                <p className="muted small">Tick to show. Use ↑ ↓ (or drag headers) to reorder.</p>
                <ul className="dt-col-list">
                  {layout.order.map((id, i) => {
                    const c = byId.get(id);
                    if (!c) return null;
                    return (
                      <li key={id}>
                        <label>
                          <input type="checkbox" checked={!layout.hidden.includes(id)} onChange={() => toggleHidden(id)} />
                          <span>{c.header}</span>
                        </label>
                        <span className="dt-col-move">
                          <button type="button" className="icon-btn" aria-label={`Move ${c.header} up`} disabled={i === 0} onClick={() => nudge(id, -1)}>↑</button>
                          <button type="button" className="icon-btn" aria-label={`Move ${c.header} down`} disabled={i === layout.order.length - 1} onClick={() => nudge(id, 1)}>↓</button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {viewStore && (
                  <>
                    <h4>Saved views</h4>
                    <label className="field compact-field">
                      <span>Apply a view</span>
                      <select value={activeView} onChange={(e) => applyView(e.target.value)}>
                        <option value="" disabled>Choose a view…</option>
                        <option value="__default">Default layout</option>
                        {viewStore.views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </label>
                    <label className="field compact-field">
                      <span>Save current layout as</span>
                      <input value={viewName} maxLength={60} placeholder="e.g. Ratings only"
                        onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveView()} />
                    </label>
                    <div className="row">
                      <button type="button" className="btn small-btn primary-outline" onClick={saveView}>Save view</button>
                      {activeView && <button type="button" className="btn small-btn" onClick={deleteView}>Delete view</button>}
                    </div>
                    <p className="muted small">Saving with an existing name updates that view. Views are saved to your account.</p>
                    {viewStore.error && <p className="error">{viewStore.error}</p>}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="segmented" role="group" aria-label="Row density">
            {(['comfortable', 'compact'] as const).map((d) => (
              <button key={d} type="button" aria-pressed={layout.density === d} className={layout.density === d ? 'on' : ''}
                onClick={() => update({ density: d })}>
                {d === 'comfortable' ? 'Comfortable' : 'Compact'}
              </button>
            ))}
          </div>
          {toolbarExtra}
        </div>

        <div className="dt-toolbar-group">
          <span className="muted small" aria-live="polite">{sorted.length.toLocaleString()} row{sorted.length === 1 ? '' : 's'}</span>
          <button type="button" className="btn small-btn" disabled={!sorted.length || exporting} onClick={() => doExport('csv')}>⬇ CSV</button>
          <button type="button" className="btn small-btn" disabled={!sorted.length || exporting} onClick={() => doExport('xlsx')}>⬇ Excel</button>
        </div>
      </div>
      {status && <p className="dt-status" role="status">{status}</p>}

      <div className="dt-scroll" tabIndex={0} aria-label={caption ? `${caption} (scrollable)` : 'Table (scrollable)'}>
        <table className="dt-table" style={{ width: totalWidth }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <colgroup>
            {visible.map((c) => <col key={c.id} style={{ width: widthOf(c) }} />)}
          </colgroup>
          <thead>
            <tr>
              {visible.map((c) => {
                const sortDir = layout.sort?.id === c.id ? layout.sort.dir : null;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'}
                    className={`${dropId === c.id && dragId !== c.id ? 'dt-drop' : ''} ${dragId === c.id ? 'dt-dragging' : ''} align-${c.align ?? 'left'}`}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropId(c.id);
                    }}
                    onDragLeave={() => setDropId((d) => (d === c.id ? null : d))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = e.dataTransfer.getData('text/x-dt-column') || dragId;
                      if (from) move(from, c.id);
                      setDragId(null);
                      setDropId(null);
                    }}
                    title={c.title ?? c.header}
                  >
                    {/* Only the label is the drag source, so the resize edge never starts a column move. */}
                    <button
                      type="button"
                      className="dt-sort"
                      draggable
                      onDragStart={(e) => {
                        setDragId(c.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/x-dt-column', c.id);
                        e.dataTransfer.setData('text/plain', c.header);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropId(null);
                      }}
                      onClick={() => toggleSort(c.id)}
                    >
                      <span className="dt-grip" aria-hidden="true">⋮⋮</span>
                      <span className="dt-head-label">{c.header}</span>
                      <span className="dt-sort-ind" aria-hidden="true">{sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : ''}</span>
                    </button>
                    <span
                      className="dt-resize"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${c.header} column`}
                      aria-valuenow={widthOf(c)}
                      tabIndex={0}
                      onPointerDown={(e) => startResize(e, c)}
                      onKeyDown={(e) => resizeKey(e, c)}
                      onDoubleClick={() => resetWidth(c)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const k = rowKey(r);
              const open = renderExpanded && expandedKey != null && expandedKey === k;
              return (
                <Fragment key={k}>
                  <tr className={rowClassName?.(r) ?? ''}>
                    {visible.map((c) => (
                      <td key={c.id} className={`align-${c.align ?? 'left'}`}>
                        {c.render ? c.render(r) : formatValue(c.value(r))}
                      </td>
                    ))}
                  </tr>
                  {open && (
                    <tr className="dt-expanded">
                      <td colSpan={visible.length}>{renderExpanded!(r)}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!sorted.length && (
              <tr>
                <td colSpan={visible.length} className="dt-empty-row">{emptyText}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
