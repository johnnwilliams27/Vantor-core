'use client';
import { useInvoices } from '@/hooks/useInvoices';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STATUS_COLORS: Record<string, string> = {
  unpaid: '#f59e0b',
  overdue: '#ef4444',
  partially_paid: '#3b82f6',
  paid: '#22c55e',
  cancelled: '#9ca3af',
};

export function InvoiceAging() {
  const { data: invoices } = useInvoices();

  const statusCounts: Record<string, number> = {};
  for (const inv of invoices ?? []) {
    statusCounts[inv.status] = (statusCounts[inv.status] ?? 0) + 1;
  }

  const chartData = Object.entries(statusCounts).map(([status, count]) => ({
    name: status.replace('_', ' '),
    value: count,
    key: status,
  }));

  if (!chartData.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Invoice Aging</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            No invoices yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Invoice Aging</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              dataKey="value"
              label={({ name, value }) => `${name}: ${value}`}
              labelLine={false}
            >
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={STATUS_COLORS[entry.key] ?? '#9ca3af'} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
