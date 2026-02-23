/**
 * Plaid helpers.
 * When PLAID_CLIENT_ID is unset, all functions return mock data (Chase Checking ****4321).
 */

const MOCK_MODE = !process.env.PLAID_CLIENT_ID;

export interface PlaidLinkTokenResult {
  linkToken: string;
  expiration: string;
}

export interface PlaidExchangeResult {
  accessToken: string;
  itemId: string;
}

export interface PlaidAccountDetails {
  institutionName: string;
  accountName: string;
  accountType: string;
  last4: string | null;
  routingNumber: string | null;
}

export async function createLinkToken(userId: string): Promise<PlaidLinkTokenResult> {
  if (MOCK_MODE) {
    return {
      linkToken: `link-sandbox-mock-${userId}-${Date.now()}`,
      expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  const { PlaidApi, PlaidEnvironments, Configuration, Products, CountryCode } = await import('plaid');

  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments ?? 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
        'PLAID-SECRET': process.env.PLAID_SECRET!,
      },
    },
  });

  const client = new PlaidApi(config);
  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Vantor Treasury',
    products: [Products.Auth],
    country_codes: [CountryCode.Us],
    language: 'en',
  });

  return {
    linkToken: response.data.link_token,
    expiration: response.data.expiration,
  };
}

export async function exchangePublicToken(publicToken: string): Promise<PlaidExchangeResult> {
  if (MOCK_MODE) {
    return {
      accessToken: `access-sandbox-mock-${Date.now()}`,
      itemId: `item-mock-${Date.now()}`,
    };
  }

  const { PlaidApi, PlaidEnvironments, Configuration } = await import('plaid');

  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments ?? 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
        'PLAID-SECRET': process.env.PLAID_SECRET!,
      },
    },
  });

  const client = new PlaidApi(config);
  const response = await client.itemPublicTokenExchange({ public_token: publicToken });

  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

export interface PlaidAccountBalance {
  available: number;
  current: number;
  isoCurrencyCode: string;
  balanceAsOf: string;
}

export async function getAccountBalance(
  accessToken: string,
  accountId: string
): Promise<PlaidAccountBalance> {
  if (MOCK_MODE || accessToken.startsWith('access-sandbox-mock')) {
    return {
      available: 250000,
      current: 252500,
      isoCurrencyCode: 'USD',
      balanceAsOf: new Date().toISOString(),
    };
  }

  const { PlaidApi, PlaidEnvironments, Configuration } = await import('plaid');

  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments ?? 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
        'PLAID-SECRET': process.env.PLAID_SECRET!,
      },
    },
  });

  const client = new PlaidApi(config);
  const response = await client.accountsBalanceGet({ access_token: accessToken });

  const account = response.data.accounts.find((a) => a.account_id === accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);

  return {
    available: account.balances.available ?? account.balances.current ?? 0,
    current: account.balances.current ?? 0,
    isoCurrencyCode: account.balances.iso_currency_code ?? 'USD',
    balanceAsOf: new Date().toISOString(),
  };
}

export async function getAccountDetails(
  accessToken: string,
  accountId: string
): Promise<PlaidAccountDetails> {
  if (MOCK_MODE || accessToken.startsWith('access-sandbox-mock')) {
    return {
      institutionName: 'Chase',
      accountName: 'Checking Account',
      accountType: 'checking',
      last4: '4321',
      routingNumber: '021000021',
    };
  }

  const { PlaidApi, PlaidEnvironments, Configuration } = await import('plaid');

  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments ?? 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
        'PLAID-SECRET': process.env.PLAID_SECRET!,
      },
    },
  });

  const client = new PlaidApi(config);
  const [authRes, itemRes] = await Promise.all([
    client.authGet({ access_token: accessToken }),
    client.itemGet({ access_token: accessToken }),
  ]);

  const account = authRes.data.accounts.find((a) => a.account_id === accountId);
  const numbers = authRes.data.numbers.ach?.find((n) => n.account_id === accountId);
  const institution = itemRes.data.item;

  return {
    institutionName: (institution as any).institution_name ?? 'Unknown Bank',
    accountName: account?.name ?? 'Account',
    accountType: account?.subtype ?? account?.type ?? 'checking',
    last4: account?.mask ?? null,
    routingNumber: numbers?.routing ?? null,
  };
}
