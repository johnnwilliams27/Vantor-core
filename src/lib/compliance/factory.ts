import type { IComplianceAdapter } from './interface';
import { ChainalysisMockAdapter } from './mock/chainalysis-mock';
import { ChainalysisAdapter } from './chainalysis';

export function getComplianceAdapter(): IComplianceAdapter {
  const useMock = process.env.CHAINALYSIS_USE_MOCK === 'true';

  if (useMock) {
    return new ChainalysisMockAdapter();
  }

  return new ChainalysisAdapter();
}
