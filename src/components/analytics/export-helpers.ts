import type { ExportColumn } from '@/lib/export';
import type { ViewResult } from '@/lib/analytics/types';

type Row = Record<string, unknown>;

/**
 * Build ExportColumn definitions from a ViewResult, based on chart type.
 * - kpi: one column per scalar key
 * - line: date column + one column per series
 * - bar: group column + one column per grouped measure
 * - table: one column per row key (auto-detected from first row)
 */
export function viewResultToCsvColumns(result: ViewResult): ExportColumn<Row>[] {
  const chartType = result.view.chartType;

  if (chartType === 'kpi' && result.scalar) {
    return Object.keys(result.scalar).map((key) => ({
      header: key,
      accessor: (row: Row) => String(row[key] ?? ''),
    }));
  }

  if (chartType === 'line' && result.series) {
    const seriesKeys = Object.keys(result.series);
    return [
      { header: 'Date', accessor: (row: Row) => String(row.date ?? '') },
      ...seriesKeys.map((key) => ({
        header: key,
        accessor: (row: Row) => String(row[key] ?? ''),
      })),
    ];
  }

  if (chartType === 'bar' && result.groups) {
    const groupKeys = Object.keys(result.groups);
    return [
      { header: 'Group', accessor: (row: Row) => String(row.group ?? '') },
      ...groupKeys.map((key) => ({
        header: key,
        accessor: (row: Row) => String(row[key] ?? ''),
      })),
    ];
  }

  if (chartType === 'table' && result.rows && result.rows.length > 0) {
    const keys = Object.keys(result.rows[0]);
    return keys.map((key) => ({
      header: key,
      accessor: (row: Row) => String(row[key] ?? ''),
    }));
  }

  return [];
}

/**
 * Flatten a ViewResult into an array of plain row objects for CSV/PDF export.
 */
export function viewResultToCsvRows(result: ViewResult): Row[] {
  const chartType = result.view.chartType;

  if (chartType === 'kpi' && result.scalar) {
    return [{ ...result.scalar }];
  }

  if (chartType === 'line' && result.series) {
    const seriesKeys = Object.keys(result.series);
    if (seriesKeys.length === 0) return [];
    const dates = result.series[seriesKeys[0]].map((p) => p.date);
    return dates.map((date, i) => {
      const row: Row = { date };
      for (const key of seriesKeys) {
        row[key] = result.series![key][i]?.value ?? 0;
      }
      return row;
    });
  }

  if (chartType === 'bar' && result.groups) {
    const groupKeys = Object.keys(result.groups);
    if (groupKeys.length === 0) return [];
    const groups = result.groups[groupKeys[0]].map((p) => p.group);
    return groups.map((group, i) => {
      const row: Row = { group };
      for (const key of groupKeys) {
        row[key] = result.groups![key][i]?.value ?? 0;
      }
      return row;
    });
  }

  if (chartType === 'table' && result.rows) {
    return result.rows as Row[];
  }

  return [];
}
