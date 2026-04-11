import { describe, it, expect } from 'vitest';
import {
  CONSERVATIVE_PROFILE,
  BALANCED_PROFILE,
  GROWTH_PROFILE,
  getProfile,
  resolveAllocationBands,
  isCustomerEligibleForKycTier,
} from './risk-profiles';

describe('risk profiles', () => {
  describe('preset integrity', () => {
    it('Conservative: 100% primary by default', () => {
      expect(CONSERVATIVE_PROFILE.bands.defaultPrimaryPct).toBe(1.0);
      expect(CONSERVATIVE_PROFILE.bands.defaultSatellitePct).toBe(0.0);
      expect(CONSERVATIVE_PROFILE.bands.satelliteYieldPremiumBps).toBe(50);
    });

    it('Balanced: 70/30 split at parity, 50/50 on 100bps+ premium', () => {
      expect(BALANCED_PROFILE.bands.defaultPrimaryPct).toBe(0.70);
      expect(BALANCED_PROFILE.bands.defaultSatellitePct).toBe(0.30);
      expect(BALANCED_PROFILE.bands.highPremiumPrimaryPct).toBe(0.50);
      expect(BALANCED_PROFILE.bands.highPremiumSatellitePct).toBe(0.50);
      expect(BALANCED_PROFILE.bands.satelliteYieldPremiumBps).toBe(100);
    });

    it('Growth: 30/70 split at parity (no premium required)', () => {
      expect(GROWTH_PROFILE.bands.defaultPrimaryPct).toBe(0.30);
      expect(GROWTH_PROFILE.bands.defaultSatellitePct).toBe(0.70);
      expect(GROWTH_PROFILE.bands.satelliteYieldPremiumBps).toBe(0);
    });

    it('safety buffer multipliers descend with risk tolerance', () => {
      expect(CONSERVATIVE_PROFILE.safetyBufferMultiplier).toBe(1.5);
      expect(BALANCED_PROFILE.safetyBufferMultiplier).toBe(1.25);
      expect(GROWTH_PROFILE.safetyBufferMultiplier).toBe(1.0);
    });

    it('per-vault concentration caps tighten with risk aversion', () => {
      expect(CONSERVATIVE_PROFILE.concentration.satellitePerVaultMaxVaultSharePct).toBe(0.05);
      expect(CONSERVATIVE_PROFILE.concentration.satellitePerVaultMaxAbsUsd).toBe(10_000_000);
      expect(BALANCED_PROFILE.concentration.satellitePerVaultMaxVaultSharePct).toBe(0.075);
      expect(BALANCED_PROFILE.concentration.satellitePerVaultMaxAbsUsd).toBe(15_000_000);
      expect(GROWTH_PROFILE.concentration.satellitePerVaultMaxVaultSharePct).toBe(0.10);
      expect(GROWTH_PROFILE.concentration.satellitePerVaultMaxAbsUsd).toBe(20_000_000);
    });

    it('Conservative curator whitelist is strictest', () => {
      expect(CONSERVATIVE_PROFILE.allowedSatelliteCurators.size).toBe(2);
      expect(CONSERVATIVE_PROFILE.allowedSatelliteCurators.has('Steakhouse Financial')).toBe(true);
      expect(CONSERVATIVE_PROFILE.allowedSatelliteCurators.has('Gauntlet')).toBe(true);
    });

    it('Growth has an open curator universe', () => {
      expect(GROWTH_PROFILE.allowedSatelliteCurators.size).toBe(0);
    });
  });

  describe('getProfile', () => {
    it('returns the correct profile by id', () => {
      expect(getProfile('conservative').id).toBe('conservative');
      expect(getProfile('balanced').id).toBe('balanced');
      expect(getProfile('growth').id).toBe('growth');
    });
  });

  describe('resolveAllocationBands (per-tier overrides)', () => {
    it('Conservative Enterprise: forced 100% primary regardless of yield gap', () => {
      const bands = resolveAllocationBands(CONSERVATIVE_PROFILE, 'enterprise');
      expect(bands.defaultPrimaryPct).toBe(1.0);
      expect(bands.defaultSatellitePct).toBe(0.0);
      expect(bands.highPremiumPrimaryPct).toBe(1.0);
      expect(bands.highPremiumSatellitePct).toBe(0.0);
    });

    it('Conservative Growth-tier: unchanged from base', () => {
      const bands = resolveAllocationBands(CONSERVATIVE_PROFILE, 'growth');
      expect(bands.defaultPrimaryPct).toBe(1.0);
      expect(bands.defaultSatellitePct).toBe(0.0);
    });

    it('Balanced Scale: held at 70/30 instead of 50/50 under premium', () => {
      const bands = resolveAllocationBands(BALANCED_PROFILE, 'scale');
      expect(bands.defaultPrimaryPct).toBe(0.70);
      expect(bands.defaultSatellitePct).toBe(0.30);
      expect(bands.highPremiumPrimaryPct).toBe(0.70);
      expect(bands.highPremiumSatellitePct).toBe(0.30);
    });

    it('Balanced Enterprise: 80/20 floor', () => {
      const bands = resolveAllocationBands(BALANCED_PROFILE, 'enterprise');
      expect(bands.defaultPrimaryPct).toBe(0.80);
      expect(bands.defaultSatellitePct).toBe(0.20);
    });

    it('Growth Scale: 50/50 instead of 30/70', () => {
      const bands = resolveAllocationBands(GROWTH_PROFILE, 'scale');
      expect(bands.defaultPrimaryPct).toBe(0.50);
      expect(bands.defaultSatellitePct).toBe(0.50);
    });

    it('Growth Enterprise: 60/40 in favor of primary', () => {
      const bands = resolveAllocationBands(GROWTH_PROFILE, 'enterprise');
      expect(bands.defaultPrimaryPct).toBe(0.60);
      expect(bands.defaultSatellitePct).toBe(0.40);
    });
  });

  describe('isCustomerEligibleForKycTier', () => {
    it('"none" venue eligibility is always allowed', () => {
      expect(isCustomerEligibleForKycTier(undefined, 'none')).toBe(true);
      expect(isCustomerEligibleForKycTier('retail', 'none')).toBe(true);
      expect(isCustomerEligibleForKycTier('accredited', 'none')).toBe(true);
      expect(isCustomerEligibleForKycTier('qualified_purchaser', 'none')).toBe(true);
    });

    it('accredited venues require accredited or QP customer', () => {
      expect(isCustomerEligibleForKycTier('accredited', 'accredited_investor')).toBe(true);
      expect(isCustomerEligibleForKycTier('qualified_purchaser', 'accredited_investor')).toBe(true);
      expect(isCustomerEligibleForKycTier('retail', 'accredited_investor')).toBe(false);
      expect(isCustomerEligibleForKycTier(undefined, 'accredited_investor')).toBe(false);
    });

    it('QP venues require QP customer', () => {
      expect(isCustomerEligibleForKycTier('qualified_purchaser', 'qualified_purchaser')).toBe(true);
      expect(isCustomerEligibleForKycTier('accredited', 'qualified_purchaser')).toBe(false);
      expect(isCustomerEligibleForKycTier('retail', 'qualified_purchaser')).toBe(false);
    });

    it('non-US-only venues are rejected for safety in v1', () => {
      expect(isCustomerEligibleForKycTier('qualified_purchaser', 'non_us_only')).toBe(false);
    });
  });
});
