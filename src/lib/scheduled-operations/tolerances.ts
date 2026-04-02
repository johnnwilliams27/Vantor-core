import type { ScheduledOperationType } from '@/types/scheduled-operations';

/** Maximum allowed deviation in basis points per operation type */
export const TOLERANCE_BPS: Record<ScheduledOperationType, number> = {
  swap: 10,
  bridge: 25,
  ramp: 50,
};

/** Calculate deviation between two rates in basis points */
export function calculateDeviationBps(originalRate: number, newRate: number): number {
  if (originalRate === 0) return 0;
  return Math.round(Math.abs((newRate - originalRate) / originalRate) * 10_000);
}

/** Extract the comparable rate from a quote object by operation type */
export function extractRate(type: ScheduledOperationType, quote: Record<string, unknown>): number {
  switch (type) {
    case 'swap':
      return parseFloat((quote.rate as string) ?? '0');
    case 'bridge': {
      const from = parseFloat((quote.fromAmount as string) ?? '0');
      const to = parseFloat((quote.toAmount as string) ?? '0');
      return from > 0 ? to / from : 0;
    }
    case 'ramp':
      return (quote.exchangeRate as number) ?? 0;
    default:
      return 0;
  }
}
