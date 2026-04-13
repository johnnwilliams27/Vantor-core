'use client';
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CardSpinner } from '@/components/ui/spinner';
import { SectionSelector } from './SectionSelector';
import { DEFAULT_SECTIONS, SECTION_REGISTRY, type SectionId } from './section-config';
import { useReportData } from '@/hooks/useReportData';
import { FileBarChart, Loader2, Download, FileText } from 'lucide-react';
import type { ViewResult } from '@/lib/analytics/types';
import type { ReportData } from '@/lib/treasury/report';
import type { AiRecommendation, FiatTransaction, Transfer, Swap, Invoice, YieldTransaction } from '@/types/database';

// Section components
import { TreasuryOverviewSection } from './sections/TreasuryOverviewSection';
import { ObligationCoverageSection } from './sections/ObligationCoverageSection';
import { RecommendationsSection } from './sections/RecommendationsSection';
import { RampHistorySection } from './sections/RampHistorySection';
import { TransfersSection } from './sections/TransfersSection';
import { SwapsSection } from './sections/SwapsSection';
import { InvoicesSection } from './sections/InvoicesSection';
import { ComplianceSection } from './sections/ComplianceSection';
import { YieldSection } from './sections/YieldSection';

// ---------------------------------------------------------------------------
// Adapters: extract typed data from ViewResult for each section component
// ---------------------------------------------------------------------------

function toTreasuryOverview(result: ViewResult, from: string, to: string): ReportData {
  const s = result.scalar ?? {};
  return {
    period: { from, to },
    summary: {
      avgBankBalanceUsd: s.bank_balance_usd ?? 0,
      avgCryptoBalanceUsd: s.stablecoin_idle_balance_usd ?? 0,
      totalOnrampUsd: s.total_onramp_usd ?? 0,
      totalOfframpUsd: s.total_offramp_usd ?? 0,
      netRampUsd: (s.total_onramp_usd ?? 0) - (s.total_offramp_usd ?? 0),
      totalFeesUsd: s.total_fees_usd ?? 0,
      recommendationCount: s.recommendation_count ?? 0,
      executedCount: s.executed_count ?? 0,
      avgObligationCoverageRatio: s.coverage_ratio ?? 0,
    },
    balanceHistory: [],
    recommendationOutcomes: [],
    obligationCoverageByWeek: [],
    rampSummary: [],
  };
}

type ObligationCoverageRow = {
  week: string;
  obligationsUsd: number;
  avgBankBalanceUsd: number;
  coverageRatio: number;
};

function toObligationCoverageRows(result: ViewResult): ObligationCoverageRow[] {
  return (result.rows ?? []).map((r) => ({
    week: String(r.week ?? r.date ?? ''),
    obligationsUsd: Number(r.obligations_usd ?? r.obligationsUsd ?? 0),
    avgBankBalanceUsd: Number(r.avg_bank_balance_usd ?? r.avgBankBalanceUsd ?? 0),
    coverageRatio: Number(r.coverage_ratio ?? r.coverageRatio ?? 0),
  }));
}

function getDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

export function ReportBuilderPanel() {
  const defaults = getDefaultDates();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [enabledSections, setEnabledSections] = useState<Set<SectionId>>(new Set(DEFAULT_SECTIONS));
  const [activeFrom, setActiveFrom] = useState<string | undefined>();
  const [activeTo, setActiveTo] = useState<string | undefined>();
  const [activeSections, setActiveSections] = useState<Set<SectionId> | undefined>();

  const report = useReportData(activeFrom, activeTo, activeSections);

  const toggleSection = useCallback((id: SectionId) => {
    setEnabledSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleGenerate = () => {
    setActiveFrom(from);
    setActiveTo(to);
    setActiveSections(new Set(enabledSections));
  };

  const isGenerated = !!activeFrom && !!activeTo && !!activeSections;

  const buildExportUrl = (format: 'csv' | 'pdf') => {
    const params = new URLSearchParams({ format, from: activeFrom ?? from, to: activeTo ?? to });
    return `/api/treasury/report?${params}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileBarChart className="h-4 w-4" />
            Report Builder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Date range */}
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
          </div>

          {/* Section selector */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Report Sections</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEnabledSections(new Set(SECTION_REGISTRY.map((s) => s.id)))}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Select all
                </button>
                <span className="text-xs text-border">|</span>
                <button
                  type="button"
                  onClick={() => setEnabledSections(new Set())}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear all
                </button>
              </div>
            </div>
            <SectionSelector enabled={enabledSections} onToggle={toggleSection} />
          </div>

          {/* Generate + export */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
            <Button onClick={handleGenerate} disabled={report.isLoading || enabledSections.size === 0}>
              {report.isLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" />Generating…</>
              ) : (
                'Generate Report'
              )}
            </Button>

            <span className="text-xs text-muted-foreground">
              {enabledSections.size} section{enabledSections.size !== 1 ? 's' : ''} selected
            </span>

            {isGenerated && !report.isLoading && (
              <div className="flex items-center gap-2 ml-auto">
                <a href={buildExportUrl('csv')} download>
                  <Button variant="outline" size="sm" className="flex items-center gap-1.5">
                    <Download className="h-3 w-3" />
                    Export CSV
                  </Button>
                </a>
                <a href={buildExportUrl('pdf')} download>
                  <Button variant="outline" size="sm" className="flex items-center gap-1.5">
                    <FileText className="h-3 w-3" />
                    Export PDF
                  </Button>
                </a>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Report output */}
      {isGenerated && (
        <div className="space-y-6">
          {report.isLoading && <CardSpinner />}

          {!report.isLoading && (
            <>
              {activeSections.has('treasury-overview') && report.treasury.data && (
                <TreasuryOverviewSection
                  data={toTreasuryOverview(report.treasury.data, activeFrom, activeTo)}
                />
              )}

              {activeSections.has('obligation-coverage') && report.obligationCoverage.data && (
                <ObligationCoverageSection
                  data={toObligationCoverageRows(report.obligationCoverage.data)}
                />
              )}

              {activeSections.has('recommendations') && report.recommendations.data &&
                (report.recommendations.data.rows ?? []).length > 0 && (
                <RecommendationsSection
                  data={report.recommendations.data.rows as unknown as AiRecommendation[]}
                />
              )}

              {activeSections.has('ramp-history') && report.rampHistory.data &&
                (report.rampHistory.data.rows ?? []).length > 0 && (
                <RampHistorySection
                  data={report.rampHistory.data.rows as unknown as FiatTransaction[]}
                />
              )}

              {activeSections.has('transfers') && report.transfers.data && (
                <TransfersSection data={report.transfers.data.rows as unknown as Transfer[]} />
              )}

              {activeSections.has('swaps') && report.swaps.data && (
                <SwapsSection data={report.swaps.data.rows as unknown as Swap[]} />
              )}

              {activeSections.has('invoices') && report.invoices.data && (
                <InvoicesSection data={report.invoices.data.rows as unknown as Invoice[]} />
              )}

              {activeSections.has('compliance') && report.compliance.data && (
                <ComplianceSection data={(report.compliance.data.scalar ?? {}) as Record<string, unknown>} />
              )}

              {activeSections.has('yield') && report.yieldTxs.data && (
                <YieldSection data={report.yieldTxs.data.rows as unknown as YieldTransaction[]} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
