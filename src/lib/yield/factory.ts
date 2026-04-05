import type { IYieldProtocol, YieldProtocolId } from './interface';
import { MockYieldAdapter } from './mock/yield-mock';

export function getYieldAdapter(protocol: YieldProtocolId): IYieldProtocol {
  // All protocols use mock adapters for now
  return new MockYieldAdapter(protocol);
}

export const ALL_YIELD_PROTOCOLS: YieldProtocolId[] = [
  'aave_v3',
  'compound_v3',
  'sky',
  'ondo',
  'morpho',
  'morpho_steakhouse',
  'kamino',
  'kamino_multiply',
  'maple',
  'ethena',
  'drift',
];
