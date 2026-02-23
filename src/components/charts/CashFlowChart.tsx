'use client';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, TrendingUp, Loader2 } from 'lucide-react';
import type { ForecastDataPoint } from '@/types/database';
import { RoleGate } from '@/components/auth/RoleGate';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

interface TooltipPayload {
  date: string;
  projectedBalanceUsd: number;
  safetyBufferUsd: number;
  obligationsDueUsd: number;
  dangerZone: number | null;
  obligationLabels: string[];
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: TooltipPayload }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="bg-popover border rounded-lg p-3 shadow-lg text-xs space-y-1 max-w-xs">
      <div className="font-semibold text-sm">{label ?? d.date}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Projected Balance</span>
        <span className="font-medium">{fmt(d.projectedBalanceUsd)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Safety Buffer</span>
        <span className="font-medium">{fmt(d.safetyBufferUsd)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Obligations Due</span>
        <span className="font-medium">{fmt(d.obligationsDueUsd)}</span>
      </div>
      {d.obligationLabels?.length > 0 && (
        <div className="pt-1 border-t">
          <div className="text-muted-foreground mb-0.5">Obligations:</div>
          {d.obligationLabels.slice(0, 3).map((l, i) => (
            <div key={i} className="text-xs truncate">• {l}</div>
          ))}
          {d.obligationLabels.length > 3 && (
            <div className="text-muted-foreground">+{d.obligationLabels.length - 3} more</div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  forecastData: ForecastDataPoint[];
  onGenerateForecast?: () => void;
  isGenerating?: boolean;
}

export function CashFlowChart({ forecastData, onGenerateForecast, isGenerating }: Props) {
  const hasDanger = forecastData.some((p) => p.isBelow);

  const chartData = forecastData.map((p) => ({
    ...p,
    dangerZone: p.isBelow ? p.projectedBalanceUsd : null,
  }));

  if (!forecastData.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Cash Flow Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
            <span>No forecast generated</span>
            <RoleGate requiredRole="treasury_manager">
              <Button
                size="sm"
                onClick={onGenerateForecast}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Generating…
                  </>
                ) : (
                  'Generate Forecast'
                )}
              </Button>
            </RoleGate>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Cash Flow Forecast
          </CardTitle>
          <div className="flex items-center gap-2">
            {hasDanger && (
              <Badge variant="destructive" className="flex items-center gap-1 text-xs">
                <AlertTriangle className="h-3 w-3" />
                Coverage Risk Detected
              </Badge>
            )}
            <RoleGate requiredRole="treasury_manager">
              <Button
                size="sm"
                variant="outline"
                onClick={onGenerateForecast}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  'Refresh'
                )}
              </Button>
            </RoleGate>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="bufferGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="dangerGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(v: string) => v.slice(5)} // Show MM-DD
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />

            <Area
              type="monotone"
              dataKey="safetyBufferUsd"
              name="Safety Buffer"
              stroke="#f59e0b"
              strokeWidth={1.5}
              fill="url(#bufferGrad)"
              strokeDasharray="4 2"
            />
            <Area
              type="monotone"
              dataKey="projectedBalanceUsd"
              name="Projected Balance"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#balanceGrad)"
            />
            {hasDanger && (
              <Area
                type="monotone"
                dataKey="dangerZone"
                name="Below Buffer"
                stroke="#ef4444"
                strokeWidth={2}
                fill="url(#dangerGrad)"
                connectNulls={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
