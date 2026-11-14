/** Shared CSV / Excel export for DataTable (exports exactly what the table shows). */

export type CellValue = string | number | boolean | Date | null | undefined;

export interface ExportColumn {
  header: string;
  /** Excel column width in characters. */
  width?: number;
}

/**
 * Spreadsheet formula injection guard: text from participants (comments) that
 * starts with = + - @ (or tab / CR) would run as a formula when opened.
 * Prefix such text with an apostrophe so it is shown, never executed.
 */
export function neutralise(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function fileStamp() {
  return new Date().toISOString().slice(0, 10);
}

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportCsv(name: string, columns: ExportColumn[], rows: CellValue[][]) {
  const fmt = (v: CellValue) => {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString();
    const s = typeof v === 'string' ? neutralise(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [columns.map((c) => fmt(c.header)), ...rows.map((r) => r.map(fmt))].map((l) => l.join(','));
  // BOM so Excel opens UTF-8 (names, ₹, accents) correctly.
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${name}-${fileStamp()}.csv`);
}

export async function exportExcel(name: string, columns: ExportColumn[], rows: CellValue[][]) {
  // Loaded on demand so the library is only downloaded when someone exports.
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const header = columns.map((c) => ({ value: c.header, fontWeight: 'bold' as const, type: String }));
  const body = rows.map((r) =>
    r.map((v) => {
      if (v == null || v === '') return null;
      if (typeof v === 'number') return { value: v, type: Number };
      if (typeof v === 'boolean') return { value: v, type: Boolean };
      if (v instanceof Date) return { value: v, type: Date, format: 'yyyy-mm-dd hh:mm' };
      // Always a String cell: Excel never evaluates it as a formula.
      return { value: String(v), type: String, wrap: true };
    }),
  );
  await writeExcelFile([header, ...body], {
    sheet: name.slice(0, 31),
    columns: columns.map((c) => ({ width: c.width ?? 16 })),
    stickyRowsCount: 1,
  }).toFile(`${name}-${fileStamp()}.xlsx`);
}
