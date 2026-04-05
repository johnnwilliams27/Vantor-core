import Stripe from 'stripe';
import type { IntegrationMode } from '@/lib/env/integration-mode';

// Countries where Belvo is used instead of Stripe FC
export const BELVO_COUNTRIES = ['BR', 'MX'];

export function getBankingProvider(country: string | null): 'stripe_fc' | 'belvo' | null {
  if (!country) return null;
  if (BELVO_COUNTRIES.includes(country)) return 'belvo';
  return 'stripe_fc'; // Stripe FC is the default for all other countries
}

function getStripeClient(_mode: IntegrationMode): Stripe {
  // Stripe uses key prefix for environment: sk_test_* = sandbox, sk_live_* = live
  // Both use the same STRIPE_SECRET_KEY env var — the key itself determines the environment
  const key = process.env.STRIPE_SECRET_KEY!;
  return new Stripe(key, { apiVersion: '2026-03-25.dahlia' });
}

/**
 * Creates a Financial Connections session.
 * Returns the client secret for the frontend widget.
 */
export async function createFCSession(mode: IntegrationMode): Promise<{
  clientSecret: string;
  sessionId: string;
}> {
  const stripe = getStripeClient(mode);

  const session = await stripe.financialConnections.sessions.create({
    account_holder: { type: 'account' },
    permissions: ['balances', 'ownership', 'transactions'],
  });

  if (!session.client_secret) {
    throw new Error('Stripe Financial Connections session did not return a client_secret');
  }

  return {
    clientSecret: session.client_secret,
    sessionId: session.id,
  };
}

/**
 * Fetches a linked Financial Connections account.
 */
export async function getFCAccount(mode: IntegrationMode, accountId: string): Promise<{
  id: string;
  institutionName: string;
  displayName: string | null;
  accountType: string;
  currency: string | null;
  last4: string | null;
}> {
  const stripe = getStripeClient(mode);
  const account = await stripe.financialConnections.accounts.retrieve(accountId);

  return {
    id: account.id,
    institutionName: account.institution_name ?? 'Bank',
    displayName: account.display_name ?? null,
    accountType: account.subcategory ?? account.category ?? 'checking',
    currency: account.balance ? (Object.keys(account.balance.current)[0]?.toUpperCase() ?? null) : null,
    last4: account.last4 ?? null,
  };
}

/**
 * Fetches balance for a Financial Connections account.
 */
export async function getFCBalance(mode: IntegrationMode, accountId: string): Promise<{
  current: number;
  available: number | null;
  currency: string;
}> {
  const stripe = getStripeClient(mode);

  // Trigger a balance refresh
  await stripe.financialConnections.accounts.refresh(accountId, {
    features: ['balance'],
  });

  // Read the updated account
  const account = await stripe.financialConnections.accounts.retrieve(accountId);
  const bal = account.balance;

  // bal.current is a map of { [currencyCode]: amountInCents }
  const currencyKey = bal ? Object.keys(bal.current)[0] : undefined;
  const currentAmount = bal && currencyKey ? bal.current[currencyKey]! : 0;

  return {
    current: currentAmount / 100,
    available: bal?.cash?.available ? Object.values(bal.cash.available)[0]! / 100 : null,
    currency: currencyKey?.toUpperCase() ?? 'USD',
  };
}
