// src/lib/policy/hard-limit-checker/templates.ts

import { HardLimitEvaluation } from '../types/hard-limit';

/**
 * Pure functions that produce human-readable breach messages and user
 * actions for each hard limit type. Separated from the evaluators so
 * message wording can be iterated without touching evaluation logic.
 */

export function renderMinCashReserveBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  return {
    human_readable:
      `This transfer would reduce cash reserves to $${formatUsd(ev.post_transfer_value)}, ` +
      `below the $${formatUsd(ev.limit_value)} minimum required by hard limit '${ev.limit_name}'. ` +
      `The treasury would be $${formatUsd(ev.overage ?? '0')} below the floor.`,
    user_action:
      `Reduce the transfer amount, or request an enterprise policy admin to raise the '${ev.limit_name}' ` +
      `limit (this is an audited action).`,
  };
}

export function renderMaxConcentrationBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  return {
    human_readable:
      `This transfer would cause a single asset to represent ${ev.post_transfer_value}% of the treasury, ` +
      `exceeding the ${ev.limit_value}% maximum set by '${ev.limit_name}'.`,
    user_action:
      `Split the transfer across multiple assets or reduce the amount. ` +
      `An enterprise policy admin can raise the '${ev.limit_name}' limit if the concentration is intentional.`,
  };
}

export function renderMaxOutflowBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  const window = ev.limit_type === 'max_daily_outflow_usd' ? '24 hours' : '30 days';
  return {
    human_readable:
      `This transfer would push the ${window} outflow total to $${formatUsd(ev.post_transfer_value)}, ` +
      `exceeding the $${formatUsd(ev.limit_value)} cap set by '${ev.limit_name}'. ` +
      `Current trailing total is $${formatUsd(ev.current_value)}; overage is $${formatUsd(ev.overage ?? '0')}.`,
    user_action:
      `Wait until the ${window} window rolls forward, reduce the transfer amount, ` +
      `or request an enterprise policy admin to raise the limit.`,
  };
}

export function renderObligationCoverageBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  return {
    human_readable:
      `This transfer would leave projected obligations uncovered within the ${ev.limit_value}-day window ` +
      `required by '${ev.limit_name}'.`,
    user_action:
      `Ensure projected inflows cover all obligations due in the window, or defer this transfer ` +
      `until the next obligation date passes.`,
  };
}

export function renderMaxNativeExposureBreach(ev: HardLimitEvaluation): {
  human_readable: string;
  user_action: string;
} {
  const asset = ev.scope.asset ?? 'the scoped asset';
  return {
    human_readable:
      `This transfer would cause ${asset} exposure to reach ${ev.post_transfer_value} ${asset}, ` +
      `exceeding the ${ev.limit_value} ${asset} cap set by '${ev.limit_name}'.`,
    user_action:
      `Reduce the transfer amount or move ${asset} to a different asset class. ` +
      `An enterprise policy admin can raise the '${ev.limit_name}' limit.`,
  };
}

function formatUsd(s: string): string {
  // Group digits with commas for readability (no decimal formatting — caller may pass decimals)
  const [whole, frac] = s.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/**
 * Dispatch to the correct template based on limit_type.
 */
export function renderBreach(ev: HardLimitEvaluation): { human_readable: string; user_action: string } {
  switch (ev.limit_type) {
    case 'min_cash_reserve_usd':
      return renderMinCashReserveBreach(ev);
    case 'max_single_asset_concentration_pct':
      return renderMaxConcentrationBreach(ev);
    case 'max_daily_outflow_usd':
    case 'max_30day_outflow_usd':
      return renderMaxOutflowBreach(ev);
    case 'obligation_coverage_days':
      return renderObligationCoverageBreach(ev);
    case 'max_native_exposure':
      return renderMaxNativeExposureBreach(ev);
    default:
      return assertNeverLimitType(ev.limit_type);
  }
}

function assertNeverLimitType(x: never): never {
  throw new Error(`Unhandled HardLimitType in renderBreach: ${String(x)}`);
}

/**
 * Validate that a decimal string can be parsed by big.js. Used by limit
 * evaluators to reject malformed treasury state values upfront so a
 * downstream big.js throw doesn't escape the never-throws contract.
 */
export function isValidDecimalString(s: string | undefined | null): boolean {
  if (s === undefined || s === null || s === '') return false;
  // Reject NaN, scientific notation, commas, currency symbols, etc.
  return /^-?\d+(\.\d+)?$/.test(s);
}
