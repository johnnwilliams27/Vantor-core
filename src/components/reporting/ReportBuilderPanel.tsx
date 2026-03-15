'use client';
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CardSpinner } from '@/components/ui/spinner';
import { SectionSelector } from './SectionSelector';
import { DEFAULT_SECTIONS, SECTION_REGISTRY, type SectionId } from './section-config';
import { useReportData } from '@/hooks/useReportData';
import { FileBarChart, Loader2, Download, FileText } from 'lucide-react';

// Section components
import { TreasuryOverviewSection } from './sections/TreasuryOverviewSection';
import { ObligationCoverageSection } from './sections/ObligationCoverageSection';
import { RecommendationsSection } from './sections/RecommendationsSection';
import { RampHistorySection } from './sections/RampHistorySection';
import { PaymentsSection } from './sections/PaymentsSection';
import { SwapsSection } from './sections/SwapsSection';
import { InvoicesSection } from './sections/InvoicesSection';
import { ComplianceSection } from './sections/ComplianceSection';
import { YieldSection } from './sections/YieldSection';

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
  const treasuryData = report.treasury.data;

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
              {activeSections.has('treasury-overview') && treasuryData && (
                <TreasuryOverviewSection data={treasuryData} />
              )}

              {activeSections.has('obligation-coverage') && treasuryData && (
                <ObligationCoverageSection data={treasuryData.obligationCoverageByWeek} />
              )}

              {activeSections.has('recommendations') && treasuryData &&
                treasuryData.recommendationOutcomes.length > 0 && (
                <RecommendationsSection data={treasuryData.recommendationOutcomes} />
              )}

              {activeSections.has('ramp-history') && treasuryData &&
                treasuryData.rampSummary.length > 0 && (
                <RampHistorySection data={treasuryData.rampSummary} />
              )}

              {activeSections.has('payments') && report.payments.data && (
                <PaymentsSection data={report.payments.data} />
              )}

              {activeSections.has('swaps') && report.swaps.data && (
                <SwapsSection data={report.swaps.data} />
              )}

              {activeSections.has('invoices') && report.invoices.data && (
                <InvoicesSection data={report.invoices.data} />
              )}

              {activeSections.has('compliance') && report.compliance.data && (
                <ComplianceSection data={report.compliance.data as Record<string, unknown>} />
              )}

              {activeSections.has('yield') && report.yieldTxs.data && (
                <YieldSection data={report.yieldTxs.data} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
