import { Skeleton } from '@/components/ui/spinner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { TableRow, TableCell } from '@/components/ui/table';

/** Skeleton for a form card (wallet selector, token, amount, button) */
export function FormCardSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-36" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ))}
        <Skeleton className="h-10 w-full rounded-xl" />
      </CardContent>
    </Card>
  );
}

/** Skeleton for a history table (header + N rows) */
export function TableCardSkeleton({ columns = 8, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filter bar skeleton */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <div className="flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
        {/* Table skeleton */}
        <div className="space-y-0">
          {/* Header row */}
          <div className="flex items-center gap-4 py-3 border-b border-white/[0.06]">
            {Array.from({ length: columns }).map((_, i) => (
              <Skeleton key={i} className="h-3 flex-1" />
            ))}
          </div>
          {/* Data rows */}
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <div key={rowIdx} className="flex items-center gap-4 py-3.5 border-b border-white/[0.03]">
              {Array.from({ length: columns }).map((_, colIdx) => (
                <Skeleton
                  key={colIdx}
                  className="h-3.5 flex-1"
                  style={{ maxWidth: colIdx === 0 ? '60px' : colIdx === columns - 1 ? '50px' : undefined }}
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Row-only skeleton for use inside an existing `<TableBody>` — renders N
 * fake rows whose cells match the column count. Drop this in place of a
 * single spinner cell when the header / card chrome is already painted
 * and only the rows are loading.
 */
export function TableRowsSkeleton({ columns = 6, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <TableRow key={rowIdx} aria-hidden="true">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <TableCell key={colIdx}>
              <Skeleton
                className="h-3.5"
                style={{
                  width: colIdx === 0 ? '60%' : colIdx === columns - 1 ? '40px' : '80%',
                }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * Grid of stat-card skeletons — for dashboards that render a row of
 * big-number cards (e.g. compliance overview, balance summary).
 */
export function StatGridSkeleton({ count = 3, columns = 3 }: { count?: number; columns?: number }) {
  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-${columns} gap-4`}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-muted/30 p-4 flex items-start gap-3">
          <Skeleton className="h-5 w-5 rounded mt-0.5" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Vertical list-item skeleton for notification drawers, obligation lists,
 * alert feeds, etc. Each row shows a small avatar/icon block + two text
 * lines so the shape reads as "a list is coming."
 */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/50">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Full page skeleton for operations pages: 2 form cards + 1 table card */
export function OperationsPageSkeleton({ formFields = 5, tableColumns = 8 }: { formFields?: number; tableColumns?: number }) {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-40" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FormCardSkeleton fields={formFields} />
        <FormCardSkeleton fields={formFields} />
      </div>
      <TableCardSkeleton columns={tableColumns} />
    </div>
  );
}
