import type { ExportColumn } from './index';

function escapeField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]) {
  const header = columns.map((c) => escapeField(c.header)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => escapeField(c.accessor(row))).join(',')
  );
  const csv = [header, ...body].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
