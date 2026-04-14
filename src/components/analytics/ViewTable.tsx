'use client';

import { useState } from 'react';
import { Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { getMeasureLabel } from '@/lib/analytics/measures';
import type { ViewResult } from '@/lib/analytics/types';

interface ViewTableProps {
  result: ViewResult;
  pageSize?: number;
}

// Columns that should be hidden from display (technical/internal fields)
const HIDDEN_COLUMNS = new Set([
  'user_id',
  'enterprise_id',
  'position_id',
  'metadata',
  'created_at',
  'updated_at',
  'id', // Hide raw IDs in favor of domain-specific identifiers
]);

export function ViewTable({ result, pageSize = 25 }: ViewTableProps) {
  const rows = result.rows ?? [];
  const [page, setPage] = useState(1);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">No data for this period</p>
        <p className="text-xs text-muted-foreground/60">
          Try widening the date range, or pick a different view.
        </p>
      </div>
    );
  }

  // Filter columns to exclude technical/hidden ones
  const allColumns = Object.keys(rows[0]);
  const columns = allColumns.filter((col) => !HIDDEN_COLUMNS.has(col));

  const totalPages = Math.ceil(rows.length / pageSize);
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const isMonetaryColumn = (col: string) => col.includes('amount') || col.includes('usd') || col.includes('volume') || col.includes('balance');

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08]">
              {columns.map((col) => (
                <th
                  key={col}
                  className={`px-3 py-3 font-semibold text-xs uppercase tracking-wide text-muted-foreground ${
                    isMonetaryColumn(col) ? 'text-right' : 'text-left'
                  }`}
                >
                  {getMeasureLabel(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                {columns.map((col) => (
                  <td
                    key={col}
                    className={`px-3 py-3 text-sm ${
                      isMonetaryColumn(col)
                        ? 'text-right text-white font-mono'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {formatCell(row[col], col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-white/[0.08] pt-4">
          <span className="font-medium">
            {start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md p-1.5 hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 py-1.5">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-md p-1.5 hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown, columnName: string): string {
  if (value === null || value === undefined) return '—';

  // Format monetary columns
  if ((columnName.includes('amount') || columnName.includes('usd') || columnName.includes('balance') || columnName.includes('volume')) && typeof value === 'number') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }

  if (typeof value === 'number') {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  const str = String(value);

  // Format timestamps
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const date = new Date(str);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Truncate long hashes
  if (columnName.includes('hash') && str.length > 16) {
    return `${str.slice(0, 8)}…${str.slice(-6)}`;
  }

  // Capitalize status-like fields
  if ((columnName === 'status' || columnName.includes('status')) && str.length < 20) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  return str;
}
