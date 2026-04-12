import type { SupabaseClient } from '@supabase/supabase-js';

export type Aggregation = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'latest';
export type MeasureUnit = 'usd' | 'count' | 'ratio' | 'percentage' | 'bps';
export type ChartType = 'kpi' | 'line' | 'bar' | 'table' | 'donut';
export type ViewKind = 'standard' | 'custom';
export type TimeGranularity = 'day' | 'week' | 'month';

export interface MeasureSource {
  table: string;
  valueColumn: string;
  dateColumn: string;
  enterpriseColumn: string;
  aggregation: Aggregation;
  baseFilters?: Record<string, unknown>;
}

export interface MeasureDefinition {
  slug: string;
  label: string;
  description: string;
  unit: MeasureUnit;
  source?: MeasureSource;
  computed?: boolean;
  dimensions: string[];
}

export interface DimensionDefinition {
  slug: string;
  label: string;
  description: string;
  column?: string;
  granularities?: TimeGranularity[];
}

export interface AnalyticsViewConfig {
  measures: string[];
  primaryDimension?: string;
  granularity?: TimeGranularity;
  defaultFilters?: Record<string, string | string[]>;
}

export interface AnalyticsView {
  id: string;
  enterpriseId: string | null;
  slug: string;
  label: string;
  description: string;
  kind: ViewKind;
  chartType: ChartType;
  config: AnalyticsViewConfig;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ViewQuery {
  from: string;
  to: string;
  filters?: Record<string, string | string[]>;
  groupBy?: string;
  granularity?: TimeGranularity;
  page?: number;
  pageSize?: number;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface GroupedPoint {
  group: string;
  value: number;
}

export interface ViewResult {
  view: Pick<AnalyticsView, 'slug' | 'label' | 'chartType'>;
  query: { from: string; to: string };
  scalar?: Record<string, number>;
  series?: Record<string, TimeSeriesPoint[]>;
  groups?: Record<string, GroupedPoint[]>;
  rows?: Record<string, unknown>[];
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface ResolverContext {
  supabase: SupabaseClient;
  enterpriseId: string;
  from: string;
  to: string;
  filters: Record<string, string | string[]>;
  groupBy?: string;
  granularity: TimeGranularity;
  page: number;
  pageSize: number;
}

export type ViewResolver = (ctx: ResolverContext) => Promise<ViewResult>;
