import type { ViewResolver } from '../types';
import { resolveTreasurySummary, resolveBalanceHistory, resolveIdleCash } from './treasury';
import { resolveObligationCoverage } from './obligations';
import { resolveForecastVsActuals } from './forecast';
import { resolveRampActivity, resolveTransferVolume, resolveSwapActivity } from './activity';
import { resolveInvoiceAging, resolveAiActions, resolveComplianceSummary, resolveYieldPerformance } from './detail';

export const RESOLVER_REGISTRY: Record<string, ViewResolver> = {
  'treasury-summary': resolveTreasurySummary,
  'balance-history': resolveBalanceHistory,
  'obligation-coverage': resolveObligationCoverage,
  'forecast-vs-actuals': resolveForecastVsActuals,
  'ramp-activity': resolveRampActivity,
  'transfer-volume': resolveTransferVolume,
  'swap-activity': resolveSwapActivity,
  'invoice-aging': resolveInvoiceAging,
  'ai-actions': resolveAiActions,
  'compliance-summary': resolveComplianceSummary,
  'yield-performance': resolveYieldPerformance,
  'idle-cash': resolveIdleCash,
};

export function getResolver(slug: string): ViewResolver | undefined {
  return RESOLVER_REGISTRY[slug];
}
