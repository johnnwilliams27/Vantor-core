import type { DimensionDefinition } from './types';

export const DIMENSIONS: DimensionDefinition[] = [
  {
    slug: 'time',
    label: 'Time',
    description: 'Time dimension for grouping data by day, week, or month',
    granularities: ['day', 'week', 'month'],
  },
  {
    slug: 'direction',
    label: 'Direction',
    description: 'Transaction direction (e.g. inbound/outbound)',
    column: 'direction',
  },
  {
    slug: 'status',
    label: 'Status',
    description: 'Record status (e.g. pending, completed, failed)',
    column: 'status',
  },
  {
    slug: 'chain',
    label: 'Chain',
    description: 'Blockchain network (e.g. ethereum, solana)',
    column: 'chain',
  },
  {
    slug: 'confidence',
    label: 'Confidence',
    description: 'Forecast or obligation confidence level',
    column: 'confidence',
  },
  {
    slug: 'action',
    label: 'Action',
    description: 'AI recommendation action type',
    column: 'action',
  },
  {
    slug: 'protocol',
    label: 'Protocol',
    description: 'Yield protocol name (e.g. aave, compound)',
    column: 'protocol',
  },
  {
    slug: 'severity',
    label: 'Severity',
    description: 'Alert severity level (e.g. low, medium, high, critical)',
    column: 'severity',
  },
  {
    slug: 'age_bucket',
    label: 'Age Bucket',
    description: 'Computed age grouping for invoice aging analysis (e.g. 0-30d, 31-60d)',
  },
];

const dimensionMap = new Map<string, DimensionDefinition>(
  DIMENSIONS.map((d) => [d.slug, d]),
);

export function getDimension(slug: string): DimensionDefinition | undefined {
  return dimensionMap.get(slug);
}

export function getDimensions(): DimensionDefinition[] {
  return DIMENSIONS;
}
