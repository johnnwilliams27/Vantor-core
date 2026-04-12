'use client';

import { BlobBackground } from '@/components/landing/BlobBackground';
import { NetworkCanvas } from '@/components/landing/NetworkCanvas';

/**
 * Auth page background — reuses the landing page's simplified ambient
 * particles + static gradient mesh. Consistent brand feel across surfaces.
 */
export function LoginBackground() {
  return (
    <>
      <BlobBackground />
      <NetworkCanvas particleCount={20} />
    </>
  );
}
