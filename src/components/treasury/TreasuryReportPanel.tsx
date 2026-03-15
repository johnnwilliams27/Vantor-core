'use client';
import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { useTreasuryReport } from '@/hooks/useTreasury';
import { FileBarChart, Download, Loader2 } from 'lucide-react';
import type { AiRecommendation, FiatTransaction } from '@/types/database';

const REC_FILTER_CONFIG = {
  searchFields: [
    'action' as const,
    'ai_reasoning' as const,
  ],
  dropdowns: [
    { key: 'status', accessor: (item: AiRecommendation) => item.status },
    { key: 'action', accessor: (item: AiRecommendation) => item.action },
  ],
};

const RAMP_REPORT_FILTER_CONFIG = {
  searchFields: [
    (item: FiatTransaction) => item.crypto_token ?? '',
    (item: FiatTransaction) => item.provider ?? '',
  ],
  dropdowns: [
    { key: 'direction', accessor: (item: FiatTransaction) => item.direction },
    { key: 'status', accessor: (item: FiatTransaction) => item.status },
  ],
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

function getDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

export function TreasuryReportPanel() {
  const defaults = getDefaultDates();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [activeFrom, setActiveFrom] = useState<string | undefined>();
  const [activeTo, setActiveTo] = useState<string | undefined>();

  const { data: report, isLoading, isError } = useTreasuryReport(activeFrom, activeTo);

  const recFilter = useTableFilter(report?.recommendationOutcomes, REC_FILTER_CONFIG);
  const rampFilter = useTableFilter(report?.rampSummary, RAMP_REPORT_FILTER_CONFIG);

  const handleLoad = () => {
    setActiveFrom(from);
    setActiveTo(to);
  };

  const buildExportUrl = (format: 'csv' | 'pdf') => {
    const params = new URLSearchParams({ format, from: activeFrom ?? from, to: activeTo ?? to });
    return `/api/treasury/report?${params}`;
  };

  return (
    <div className="space-y-4">
      {/* Date range + controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileBarChart className="h-4 w-4" />
            Treasury Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <Button onClick={handleLoad} disabled={isLoading}>
              {isLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" />Loading…</>
              ) : (
                'Load Report'
              )}
            </Button>

            {activeFrom && activeTo && (
              <>
                <a href={buildExportUrl('csv')} download className="inline-flex">
                  <Button variant="outline" size="sm" className="flex items-center gap-1.5">
                    <Download className="h-3 w-3" />
                    Export CSV
                  </Button>
                </a>
                <a href={buildExportUrl('pdf')} download className="inline-flex">
                  <Button variant="outline" size="sm" className="flex items-center gap-1.5">
                    <Download className="h-3 w-3" />
                    Export PDF
                  </Button>
                </a>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Report content */}
      {isError && (
        <div className="text-sm text-destructive text-center py-4">
          Failed to load report. Please try again.
        </div>
      )}

      {report && (
        <>
          {/* Summary stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Summary · {report.period.from} — {report.period.to}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Avg Bank Balance', value: fmt(report.summary.avgBankBalanceUsd) },
                  { label: 'Avg Crypto Balance', value: fmt(report.summary.avgCryptoBalanceUsd) },
                  { label: 'Total On-Ramp', value: fmt(report.summary.totalOnrampUsd) },
                  { label: 'Total Off-Ramp', value: fmt(report.summary.totalOfframpUsd) },
                  { label: 'Net Ramp', value: fmt(report.summary.netRampUsd) },
                  {
                    label: 'Avg Coverage Ratio',
                    value: `${report.summary.avgObligationCoverageRatio.toFixed(2)}×`,
                  },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
                    <div className="text-base font-bold">{s.value}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Weekly coverage chart */}
          {report.obligationCoverageByWeek.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Weekly Obligation Coverage Ratio</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={report.obligationCoverageByWeek}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={40} />
                    <Tooltip
                      formatter={(v: number, name: string) => [
                        name === 'coverageRatio' ? `${v.toFixed(2)}×` : fmt(v),
                        name === 'coverageRatio' ? 'Coverage Ratio' : 'Obligations (USD)',
                      ]}
                    />
                    <Bar
                      dataKey="coverageRatio"
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                      name="coverageRatio"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Recommendation outcomes */}
          {report.recommendationOutcomes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  AI Recommendation Outcomes ({report.recommendationOutcomes.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FilterBar
                  search={recFilter.search}
                  onSearchChange={recFilter.setSearch}
                  searchPlaceholder="Search recommendations..."
                  dropdowns={[
                    { key: 'status', label: 'Status', options: recFilter.dropdownOptions.status ?? [] },
                    { key: 'action', label: 'Action', options: recFilter.dropdownOptions.action ?? [] },
                  ]}
                  filters={recFilter.filters}
                  onFilterChange={recFilter.setFilter}
                  resultCount={recFilter.filteredData.length}
                  totalCount={recFilter.totalCount}
                  activeFilterCount={recFilter.activeFilterCount}
                  onClear={recFilter.clearAll}
                />
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Action</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Reasoning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recFilter.pagedData.map((rec, i) => (
                        <tr
                          key={rec.id}
                          className={`border-b ${i % 2 === 0 ? '' : 'bg-muted/20'}`}
                        >
                          <td className="px-3 py-2 font-mono">{rec.created_at.split('T')[0]}</td>
                          <td className="px-3 py-2 capitalize">{rec.action}</td>
                          <td className="px-3 py-2">
                            {rec.recommended_amount_usd
                              ? fmt(parseFloat(rec.recommended_amount_usd))
                              : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className="capitalize">{rec.status.replace('_', ' ')}</span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">
                            {rec.ai_reasoning.slice(0, 80)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <TablePagination
                  page={recFilter.page}
                  totalPages={recFilter.totalPages}
                  pageSize={recFilter.pageSize}
                  filteredCount={recFilter.filteredCount}
                  onPageChange={recFilter.setPage}
                  onPageSizeChange={recFilter.setPageSize}
                />
              </CardContent>
            </Card>
          )}

          {/* Ramp history */}
          {report.rampSummary.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Ramp History ({report.rampSummary.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FilterBar
                  search={rampFilter.search}
                  onSearchChange={rampFilter.setSearch}
                  searchPlaceholder="Search ramps..."
                  dropdowns={[
                    { key: 'direction', label: 'Direction', options: rampFilter.dropdownOptions.direction ?? [] },
                    { key: 'status', label: 'Status', options: rampFilter.dropdownOptions.status ?? [] },
                  ]}
                  filters={rampFilter.filters}
                  onFilterChange={rampFilter.setFilter}
                  resultCount={rampFilter.filteredData.length}
                  totalCount={rampFilter.totalCount}
                  activeFilterCount={rampFilter.activeFilterCount}
                  onClear={rampFilter.clearAll}
                />
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Direction</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Fiat Amount</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Currency</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Token</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Provider</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rampFilter.pagedData.map((ramp, i) => (
                        <tr
                          key={ramp.id}
                          className={`border-b ${i % 2 === 0 ? '' : 'bg-muted/20'}`}
                        >
                          <td className="px-3 py-2 font-mono">{ramp.created_at.split('T')[0]}</td>
                          <td className="px-3 py-2 capitalize">{ramp.direction}</td>
                          <td className="px-3 py-2">{fmt(parseFloat(ramp.fiat_amount))}</td>
                          <td className="px-3 py-2">{ramp.fiat_currency}</td>
                          <td className="px-3 py-2">{ramp.crypto_token}</td>
                          <td className="px-3 py-2 capitalize">{ramp.status}</td>
                          <td className="px-3 py-2">{ramp.provider}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <TablePagination
                  page={rampFilter.page}
                  totalPages={rampFilter.totalPages}
                  pageSize={rampFilter.pageSize}
                  filteredCount={rampFilter.filteredCount}
                  onPageChange={rampFilter.setPage}
                  onPageSizeChange={rampFilter.setPageSize}
                />
              </CardContent>
            </Card>
          )}

          {report.recommendationOutcomes.length === 0 &&
            report.rampSummary.length === 0 &&
            report.balanceHistory.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg bg-muted/20">
                No data found for the selected period.
              </div>
            )}
        </>
      )}
    </div>
  );
}
