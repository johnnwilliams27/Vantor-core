'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilterBar } from '@/components/ui/filter-bar';
import { HoverTooltip } from '@/components/ui/hover-tooltip';
import { TablePagination } from '@/components/ui/table-pagination';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';
import { useTableFilter } from '@/hooks/useTableFilter';
import { useToast } from '@/components/ui/toast';
import { formatCurrency, formatRelativeOrDate, capitalize } from '@/lib/utils';
import type { ApprovalRequest } from '@/lib/policy/approvals/types';
import { ApprovalDetailDialog } from '@/components/approvals/ApprovalDetailDialog';

const STATUS_COLORS: Record<string, string> = {
  pending: 'warning',
  approved: 'info',
  executed: 'success',
  denied: 'destructive',
  cancelled: 'secondary',
  escalated: 'warning',
};

const APPROVAL_FILTER_CONFIG = {
  searchFields: [],
  dropdowns: [
    { key: 'status', accessor: (item: ApprovalRequest) => item.status },
    { key: 'kind', accessor: (item: ApprovalRequest) => item.proposed_movement.kind },
  ],
  dateField: (item: ApprovalRequest) => item.created_at,
  sortColumns: [
    { key: 'amount', accessor: (item: ApprovalRequest) => parseFloat(item.proposed_movement.amount.amount), type: 'number' as const },
    { key: 'date', accessor: (item: ApprovalRequest) => item.created_at, type: 'date' as const },
  ],
};

function slotsFilled(request: ApprovalRequest): { filled: number; total: number } {
  const total = request.slot_assignments?.length ?? 0;
  const filled = (request.slot_assignments ?? []).filter((s) => s.filled_by).length;
  return { filled, total };
}

function movementSummary(request: ApprovalRequest): string {
  const m = request.proposed_movement;
  const src = m.source.label ?? m.source.venue;
  const dst = m.destination.label ?? m.destination.venue;
  return `${src} → ${dst}`;
}

export default function ApprovalsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: approvals, isLoading } = useQuery({
    queryKey: ['approvals'],
    queryFn: async (): Promise<ApprovalRequest[]> => {
      const res = await fetch('/api/policy/approvals');
      if (!res.ok) throw new Error('Failed to load approvals');
      const json = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 30_000,
  });

  const filter = useTableFilter<ApprovalRequest>(approvals, APPROVAL_FILTER_CONFIG);

  const pendingCount = useMemo(
    () => (approvals ?? []).filter((r) => r.status === 'pending').length,
    [approvals],
  );

  const selected = selectedId
    ? (approvals ?? []).find((r) => r.id === selectedId) ?? null
    : null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['approvals'] });
  };

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Pending approvals</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Money movements that policy required a human to sign off on before execution.
          </p>
        </div>
        {pendingCount > 0 && (
          <Badge variant="warning" className="text-xs">
            {pendingCount} pending
          </Badge>
        )}
      </div>

      <Card className="rounded-xl dark:border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            All requests
            {filter.totalCount > 0 && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-white/[0.06] text-muted-foreground">
                {filter.totalCount}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterBar
            search={filter.search}
            onSearchChange={filter.setSearch}
            searchPlaceholder="Search approvals..."
            dropdowns={[
              { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
              { key: 'kind', label: 'Kind', options: filter.dropdownOptions.kind ?? [] },
            ]}
            filters={filter.filters}
            onFilterChange={filter.setFilter}
            showDateRange
            dateFrom={filter.dateFrom}
            dateTo={filter.dateTo}
            onDateFromChange={filter.setDateFrom}
            onDateToChange={filter.setDateTo}
            resultCount={filter.filteredData.length}
            totalCount={filter.totalCount}
            activeFilterCount={filter.activeFilterCount}
            onClear={filter.clearAll}
          />

          <div className="relative overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="font-semibold text-xs uppercase tracking-wide">Kind</TableHead>
                  <TableHead scope="col" className="font-semibold text-xs uppercase tracking-wide">Movement</TableHead>
                  <TableHead scope="col" className="text-right font-semibold text-xs uppercase tracking-wide">
                    <button
                      type="button"
                      onClick={() => filter.toggleSort('amount')}
                      className="flex items-center gap-1 ml-auto hover:text-white transition-colors group"
                    >
                      Amount
                      <span className={`text-3xs ${filter.sortKey === 'amount' ? 'text-teal-400' : 'opacity-0 group-hover:opacity-40'}`}>
                        {filter.sortKey === 'amount' ? (filter.sortDir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead scope="col" className="font-semibold text-xs uppercase tracking-wide">Progress</TableHead>
                  <TableHead scope="col" className="font-semibold text-xs uppercase tracking-wide">
                    <button
                      type="button"
                      onClick={() => filter.toggleSort('date')}
                      className="flex items-center gap-1 hover:text-white transition-colors group"
                    >
                      Age
                      <span className={`text-3xs ${filter.sortKey === 'date' ? 'text-teal-400' : 'opacity-0 group-hover:opacity-40'}`}>
                        {filter.sortKey === 'date' ? (filter.sortDir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead scope="col" className="font-semibold text-xs uppercase tracking-wide">Status</TableHead>
                  <TableHead scope="col" className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <TableCardSkeleton columns={7} rows={5} />
                    </TableCell>
                  </TableRow>
                ) : filter.pagedData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-12">
                      No approval requests match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filter.pagedData.map((r: ApprovalRequest) => {
                    const { filled, total } = slotsFilled(r);
                    const age = formatRelativeOrDate(r.created_at);
                    return (
                      <TableRow
                        key={r.id}
                        onClick={() => setSelectedId(r.id)}
                        className="cursor-pointer hover:bg-white/[0.04] transition-colors"
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground uppercase">{r.proposed_movement.kind}</TableCell>
                        <TableCell className="text-sm">{movementSummary(r)}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {formatCurrency(r.proposed_movement.amount.amount)}{' '}
                          <span className="text-muted-foreground font-normal">{r.proposed_movement.amount.asset}</span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {filled}/{total}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <HoverTooltip label={age.full}>
                            <span>{age.text}</span>
                          </HoverTooltip>
                        </TableCell>
                        <TableCell>
                          <Badge variant={(STATUS_COLORS[r.status] ?? 'secondary') as any}>
                            {capitalize(r.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <TablePagination
            page={filter.page}
            totalPages={filter.totalPages}
            pageSize={filter.pageSize}
            filteredCount={filter.filteredCount}
            onPageChange={filter.setPage}
            onPageSizeChange={filter.setPageSize}
          />
        </CardContent>
      </Card>

      {selected && (
        <ApprovalDetailDialog
          request={selected}
          onClose={() => setSelectedId(null)}
          onActionComplete={() => {
            invalidate();
            toast({ title: 'Updated', variant: 'success' });
          }}
        />
      )}
    </div>
  );
}
