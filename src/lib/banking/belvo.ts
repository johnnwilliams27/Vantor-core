import { getCredential, type IntegrationMode } from '@/lib/env/integration-mode';

const BELVO_API_URL = 'https://api.belvo.com';
const BELVO_API_URL_SANDBOX = 'https://sandbox.belvo.com';

function getBaseUrl(mode: IntegrationMode): string {
  return mode === 'live' ? BELVO_API_URL : BELVO_API_URL_SANDBOX;
}

function getAuth(mode: IntegrationMode): string {
  const keyId = getCredential(mode, process.env.BELVO_SECRET_KEY_ID_SANDBOX, process.env.BELVO_SECRET_KEY_ID_LIVE);
  const keyPassword = getCredential(mode, process.env.BELVO_SECRET_KEY_PASSWORD_SANDBOX, process.env.BELVO_SECRET_KEY_PASSWORD_LIVE);
  return Buffer.from(`${keyId}:${keyPassword}`).toString('base64');
}

export async function createWidgetToken(mode: IntegrationMode): Promise<string> {
  const baseUrl = getBaseUrl(mode);
  const res = await fetch(`${baseUrl}/api/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${getAuth(mode)}`,
    },
    body: JSON.stringify({
      id: getCredential(mode, process.env.BELVO_SECRET_KEY_ID_SANDBOX, process.env.BELVO_SECRET_KEY_ID_LIVE),
      password: getCredential(mode, process.env.BELVO_SECRET_KEY_PASSWORD_SANDBOX, process.env.BELVO_SECRET_KEY_PASSWORD_LIVE),
      scopes: 'read_institutions,read_accounts,read_balances',
    }),
  });

  if (!res.ok) throw new Error(`Belvo token creation failed: ${await res.text()}`);
  const data = await res.json();
  return data.access;
}

export async function getAccounts(mode: IntegrationMode, linkId: string): Promise<{
  accountId: string;
  name: string;
  type: string;
  currency: string;
  institution: string;
  number: string | null;
}[]> {
  const baseUrl = getBaseUrl(mode);
  const res = await fetch(`${baseUrl}/api/accounts/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${getAuth(mode)}`,
    },
    body: JSON.stringify({ link: linkId }),
  });

  if (!res.ok) throw new Error(`Belvo accounts fetch failed: ${await res.text()}`);
  const data = await res.json();

  return (Array.isArray(data) ? data : [data]).map((acc: any) => ({
    accountId: acc.id,
    name: acc.name || 'Account',
    type: acc.type || 'checking',
    currency: acc.currency || 'BRL',
    institution: acc.institution?.name || 'Bank',
    number: acc.number || null,
  }));
}

export async function getBalances(mode: IntegrationMode, linkId: string, accountId: string): Promise<{
  current: number;
  available: number;
  currency: string;
}> {
  const baseUrl = getBaseUrl(mode);
  const res = await fetch(`${baseUrl}/api/balances/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${getAuth(mode)}`,
    },
    body: JSON.stringify({
      link: linkId,
      date_from: new Date().toISOString().split('T')[0],
      date_to: new Date().toISOString().split('T')[0],
    }),
  });

  if (!res.ok) throw new Error(`Belvo balances fetch failed: ${await res.text()}`);
  const data = await res.json();

  const balance = (Array.isArray(data) ? data : [data]).find(
    (b: any) => b.account?.id === accountId,
  );

  return {
    current: balance?.current_balance ?? 0,
    available: balance?.available_balance ?? 0,
    currency: balance?.currency || 'BRL',
  };
}
