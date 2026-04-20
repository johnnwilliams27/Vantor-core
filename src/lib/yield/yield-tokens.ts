import type { YieldProtocolId } from './interface';

/**
 * Canonical receipt-token symbols by protocol. Single source of truth — the
 * mock adapter, confirm-deposit, and record-pending-deposit all read from
 * here. When adding a new protocol, add it here first or tests will fail.
 */
export const YIELD_TOKENS: Record<YieldProtocolId, string> = {
  aave_v3:           'aUSDC',
  compound_v3:       'cUSDCv3',
  morpho_reservoir:  'bbqUSDCreservoir',
  morpho_steakhouse: 'mshUSDC',
  kamino:            'kUSDC',
  kamino_multiply:   'kmUSDC',
  ondo_usdy:         'USDY',
  sky:               'sUSDS',
  ethena:            'sUSDe',
  buidl:             'BUIDL',
  ousg:              'OUSG',
  ustb:              'USTB',
  benji:             'BENJI',
  usyc:              'USYC',
  spiko_usd:         'USTBL',
};

export function getYieldTokenSymbol(protocol: YieldProtocolId): string {
  const sym = YIELD_TOKENS[protocol];
  if (!sym) throw new Error(`unknown yield protocol: ${protocol}`);
  return sym;
}
