'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, capitalize } from '@/lib/utils';
import type { AuditLog } from '@/types/database';
import { Loader2, Shield } from 'lucide-react';


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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-gray-500" />
        <h2 className="text-lg font-semibold">Audit Trail</h2>
        {result?.total !== undefined && (
          <span className="text-sm text-gray-400">({result.total} entries)</span>
        )}
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
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
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : logs.length ? (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-gray-500 whitespace-nowrap">
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
                    <TableCell className="text-sm text-gray-500">
                      {log.entity_type ? `${log.entity_type} ${log.entity_id?.slice(0, 8)}…` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-gray-400 max-w-xs truncate">
                      {log.details ? JSON.stringify(log.details) : ''}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-gray-400 py-8">
                    No audit events yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
