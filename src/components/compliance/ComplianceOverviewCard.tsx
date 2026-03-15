'use client';
import { useComplianceOverview } from '@/hooks/useCompliance';
import { CardSpinner } from '@/components/ui/spinner';
import { ShieldCheck, ShieldAlert, Eye, Plane } from 'lucide-react';

export function ComplianceOverviewCard() {
  const { data, isLoading } = useComplianceOverview();

  if (isLoading) {
    return <CardSpinner />;
  }

  if (!data) return null;

  const cards = [
    {
      label: 'Screenings (24h)',
      value: data.screenings24h,
      icon: ShieldCheck,
      color: 'text-blue-500',
    },
    {
      label: 'Sanctioned Hits',
      value: data.sanctionedHits24h,
      icon: ShieldAlert,
      color: data.sanctionedHits24h > 0 ? 'text-red-500' : 'text-green-500',
    },
    {
      label: 'Open KYT Alerts',
      value: data.totalOpenAlerts,
      icon: Eye,
      color: data.totalOpenAlerts > 0 ? 'text-amber-500' : 'text-green-500',
    },
    {
      label: 'Pending Travel Rule',
      value: data.pendingTravelRule,
      icon: Plane,
      color: data.pendingTravelRule > 0 ? 'text-amber-500' : 'text-green-500',
    },
  ];

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-4">Compliance Overview</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border bg-muted/30 p-4 flex items-start gap-3"
          >
            <card.icon className={`h-5 w-5 mt-0.5 ${card.color}`} />
            <div>
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {data.openAlerts.high + data.openAlerts.severe > 0 && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-400">
          {data.openAlerts.severe > 0 && (
            <span className="font-medium">{data.openAlerts.severe} severe</span>
          )}
          {data.openAlerts.severe > 0 && data.openAlerts.high > 0 && ' and '}
          {data.openAlerts.high > 0 && (
            <span className="font-medium">{data.openAlerts.high} high</span>
          )}
          {' '}severity alert{(data.openAlerts.high + data.openAlerts.severe) > 1 ? 's' : ''} require attention
        </div>
      )}
    </div>
  );
}
