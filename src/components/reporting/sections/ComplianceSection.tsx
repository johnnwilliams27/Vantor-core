'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, AlertTriangle, Eye } from 'lucide-react';

interface ComplianceOverview {
  screenings?: { total?: number; sanctioned?: number; clean?: number };
  kytAlerts?: { total?: number; open?: number; high?: number; medium?: number; low?: number };
  [key: string]: unknown;
}

function StatCard({ label, value, icon: Icon, variant = 'default' }: {
  label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; variant?: 'default' | 'warning' | 'success';
}) {
  const colors = {
    default: 'border-border bg-muted/30',
    warning: 'border-orange-500/20 bg-orange-500/5',
    success: 'border-green-500/20 bg-green-500/5',
  };
  return (
    <div className={`rounded-lg border p-3 ${colors[variant]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

export function ComplianceSection({ data }: { data: ComplianceOverview }) {
  const screenings = data.screenings ?? {};
  const alerts = data.kytAlerts ?? {};

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Compliance Snapshot</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* Sanctions */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Sanctions Screening</div>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total Screenings" value={screenings.total ?? 0} icon={ShieldCheck} />
            <StatCard label="Clean" value={screenings.clean ?? 0} icon={ShieldCheck} variant="success" />
            <StatCard label="Sanctioned Hits" value={screenings.sanctioned ?? 0} icon={AlertTriangle}
              variant={(screenings.sanctioned ?? 0) > 0 ? 'warning' : 'default'} />
          </div>
        </div>

        {/* KYT Alerts */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Transaction Monitoring (KYT)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Alerts" value={alerts.total ?? 0} icon={Eye} />
            <StatCard label="Open" value={alerts.open ?? 0} icon={Eye}
              variant={(alerts.open ?? 0) > 0 ? 'warning' : 'default'} />
            <StatCard label="High Severity" value={alerts.high ?? 0} icon={AlertTriangle}
              variant={(alerts.high ?? 0) > 0 ? 'warning' : 'default'} />
            <StatCard label="Medium / Low" value={`${alerts.medium ?? 0} / ${alerts.low ?? 0}`} icon={Eye} />
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
