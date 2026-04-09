'use client';
import { ComplianceOverviewCard } from './ComplianceOverviewCard';
import { SanctionsScreeningPanel } from './SanctionsScreeningPanel';
import { KytAlertsTable } from './KytAlertsTable';
import { KytTransfersTable } from './KytTransfersTable';

export function CompliancePageClient() {
  return (
    <div className="space-y-6">
      <ComplianceOverviewCard />
      <SanctionsScreeningPanel />
      <KytAlertsTable />
      <KytTransfersTable />
    </div>
  );
}
