'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatDateTime, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { AuditLog } from '@/types/database';
import { Shield } from 'lucide-react';
import { TableRowsSkeleton } from '@/components/ui/operations-skeletons';

const AUDIT_EXPORT_COLUMNS: ExportColumn<AuditLog>[] = [
  { header: 'Timestamp', accessor: (r) => formatDateTime(r.created_at), pdfWidth: '18%' },
  { header: 'User', accessor: (r) => (r as any).user_profile?.email ?? r.user_id?.slice(0, 8) ?? 'System', pdfWidth: '20%' },
  { header: 'Action', accessor: (r) => capitalize(r.action), pdfWidth: '18%' },
  { header: 'Entity', accessor: (r) => r.entity_type ? `${r.entity_type} ${r.entity_id?.slice(0, 8)}` : '', pdfWidth: '18%' },
  { header: 'Details', accessor: (r) => r.details ? JSON.stringify(r.details) : '', pdfWidth: '26%' },
];

const AUDIT_FILTER_CONFIG = {
  searchFields: [
    (item: AuditLog) => (item as any).user_profile?.email ?? '',
    'action' as const,
    (item: AuditLog) => item.entity_type ?? '',
    (item: AuditLog) => JSON.stringify(item.details ?? ''),
  ],
  dropdowns: [
    { key: 'action', accessor: (item: AuditLog) => item.action },
  ],
  dateField: (item: AuditLog) => item.created_at,
};

export function AuditTable() {
  const { data: result, isLoading } = useQuery<{ data: AuditLog[]; total: number }>({
    queryKey: ['audit-logs'],
    queryFn: async () => {
      const res = await fetch('/api/audit?limit=100');
      if (!res.ok) throw new Error('Failed to load');
      return res.json();
    },
    staleTime: 30_000,
  });

  const logs = result?.data ?? [];
  const filter = useTableFilter(logs, AUDIT_FILTER_CONFIG);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Audit</CardTitle>
          {result?.total !== undefined && (
            <span className="text-sm text-muted-foreground">({result.total} entries)</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
      <FilterBar
        search={filter.search}
        onSearchChange={filter.setSearch}
        searchPlaceholder="Search audit logs..."
        dropdowns={[
          { key: 'action', label: 'Action', options: filter.dropdownOptions.action ?? [] },
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
        onExportCsv={() => exportCsv('audit-log', AUDIT_EXPORT_COLUMNS, filter.filteredData)}
        onExportPdf={() => exportPdf('audit-log', 'Audit', AUDIT_EXPORT_COLUMNS, filter.filteredData, 'landscape')}
      />

      <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRowsSkeleton columns={5} rows={5} />
              ) : filter.pagedData.length ? (
                filter.pagedData.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {(log as any).user_profile?.email ?? log.user_id?.slice(0, 8) ?? 'System'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {capitalize(log.action)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.entity_type ? `${log.entity_type} ${log.entity_id?.slice(0, 8)}…` : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {log.details ? JSON.stringify(log.details) : ''}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {filter.activeFilterCount > 0 ? 'No matching audit events.' : 'No audit events yet.'}
                  </TableCell>
                </TableRow>
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
  );
}
