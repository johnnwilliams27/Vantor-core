'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PageSize } from '@/hooks/useTableFilter';

interface TablePaginationProps {
  page: number;
  totalPages: number;
  pageSize: PageSize;
  filteredCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
}

export function TablePagination({
  page,
  totalPages,
  pageSize,
  filteredCount,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  if (filteredCount <= 25) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, filteredCount);

  return (
    <div className="flex items-center justify-between pt-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{start}–{end} of {filteredCount}</span>
        {filteredCount > 25 && (
          <>
            <span className="text-border">|</span>
            <span>Show</span>
            {([25, 50] as PageSize[]).map((size) => (
              <button
                key={size}
                onClick={() => onPageSizeChange(size)}
                className={cn(
                  'px-1.5 py-0.5 rounded transition-colors',
                  pageSize === size
                    ? 'bg-primary text-white font-medium'
                    : 'hover:bg-muted',
                )}
              >
                {size}
              </button>
            ))}
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="h-7 w-7 flex items-center justify-center rounded-md border border-input bg-background text-sm transition-colors hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .reduce<(number | 'ellipsis')[]>((acc, p, i, arr) => {
              if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('ellipsis');
              acc.push(p);
              return acc;
            }, [])
            .map((item, i) =>
              item === 'ellipsis' ? (
                <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">...</span>
              ) : (
                <button
                  key={item}
                  onClick={() => onPageChange(item)}
                  className={cn(
                    'h-7 min-w-[28px] px-1.5 flex items-center justify-center rounded-md text-xs transition-colors',
                    page === item
                      ? 'bg-primary text-white font-medium'
                      : 'border border-input bg-background hover:bg-accent',
                  )}
                >
                  {item}
                </button>
              )
            )}

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="h-7 w-7 flex items-center justify-center rounded-md border border-input bg-background text-sm transition-colors hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
