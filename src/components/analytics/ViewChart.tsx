'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';
import { getMeasureLabel } from '@/lib/analytics/measures';
import type { ViewResult } from '@/lib/analytics/types';

const COLORS = [
  'hsl(182, 58%, 45%)', // teal
  '#f59e0b',            // amber
  '#8b5cf6',            // purple
  '#ef4444',            // red
  '#22c55e',            // green
];

interface ViewChartProps {
  result: ViewResult;
  height?: number;
}

function hasAnyValues(record: Record<string, { value: number }[]> | undefined): boolean {
  if (!record) return false;
  for (const key of Object.keys(record)) {
    for (const p of record[key]) {
      if (p.value !== 0) return true;
    }
  }
  return false;
}

function ChartEmptyState({ height }: { height: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 text-center"
      style={{ height }}
    >
      <LineChartIcon className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-sm font-medium text-muted-foreground">No data for this period</p>
      <p className="text-xs text-muted-foreground/60">
        Try widening the date range, or pick a different view.
      </p>
    </div>
  );
}

export function ViewChart({ result, height = 300 }: ViewChartProps) {
  const { chartType } = result.view;

  if (chartType === 'line' && result.series) {
    if (!hasAnyValues(result.series)) return <ChartEmptyState height={height} />;
    return <LineChartView result={result} height={height} />;
  }

  if (chartType === 'bar' && result.groups) {
    if (!hasAnyValues(result.groups)) return <ChartEmptyState height={height} />;
    return <BarChartView result={result} height={height} />;
  }

  return null;
}

function LineChartView({ result, height }: { result: ViewResult; height: number }) {
  const series = result.series!;
  const seriesKeys = Object.keys(series);
  if (seriesKeys.length === 0) return null;

  // Merge all series into unified data array keyed by date
  const dates = series[seriesKeys[0]].map((p) => p.date);
  const data = dates.map((date, i) => {
    const point: Record<string, unknown> = { date };
    for (const key of seriesKeys) {
      point[key] = series[key][i]?.value ?? 0;
    }
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
          labelStyle={{ color: '#94a3b8' }}
        />
        <Legend />
        {seriesKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={getMeasureLabel(key)}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function BarChartView({ result, height }: { result: ViewResult; height: number }) {
  const groups = result.groups!;
  const groupKeys = Object.keys(groups);
  if (groupKeys.length === 0) return null;

  // Merge all groups into unified data array keyed by group name
  const groupNames = groups[groupKeys[0]].map((p) => p.group);
  const data = groupNames.map((group, i) => {
    const point: Record<string, unknown> = { group };
    for (const key of groupKeys) {
      point[key] = groups[key][i]?.value ?? 0;
    }
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="group" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
          labelStyle={{ color: '#94a3b8' }}
        />
        <Legend />
        {groupKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            name={getMeasureLabel(key)}
            fill={COLORS[i % COLORS.length]}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
