// src/lib/test-mode/seed/banking.ts
import { SeedContext, daysAgo, rand, pick } from './helpers';

const TEST_BANKS = [
  { institution: 'JPMorgan Chase', name: 'Primary Operating', last4: '4521', currency: 'USD', balance: '450000.00' },
  { institution: 'Silicon Valley Bank', name: 'Reserves', last4: '7832', currency: 'USD', balance: '1200000.00' },
  { institution: 'Mercury', name: 'Startup Ops', last4: '1290', currency: 'USD', balance: '85000.00' },
  { institution: 'Barclays', name: 'EUR Operations', last4: '6614', currency: 'EUR', balance: '320000.00' },
  { institution: 'HSBC', name: 'GBP Account', last4: '5507', currency: 'GBP', balance: '175000.00' },
  { institution: 'Deutsche Bank', name: 'EU Reserves', last4: '3341', currency: 'EUR', balance: '500000.00' },
];

const LATAM_BANKS = [
  { institution: 'Itaú Unibanco', name: 'Conta Corrente', last4: '7823', currency: 'BRL', balance: '1415400.00', nickname: 'Itaú BRL Primary', banking_provider: 'belvo' },
  { institution: 'Nubank', name: 'Conta PJ', last4: '3491', currency: 'BRL', balance: '479775.00', nickname: 'Nubank BRL Operations', banking_provider: 'belvo' },
  { institution: 'BBVA México', name: 'Cuenta Empresarial', last4: '6102', currency: 'MXN', balance: '25707500.00', nickname: 'BBVA MXN Treasury', banking_provider: 'belvo' },
];

export interface BankIds {
  bankAccountIds: string[];
}

export async function seedBanking(ctx: SeedContext): Promise<BankIds> {
  const { supabase, enterpriseId, userId } = ctx;
  const now = new Date().toISOString();

  const bankRows = TEST_BANKS.map(b => ({
    user_id: userId,
    enterprise_id: enterpriseId,
    institution_name: b.institution,
    account_name: b.name,
    account_type: 'checking',
    last4: b.last4,
    currency: b.currency,
    current_balance: b.balance,
    balance_currency: b.currency,
    balance_as_of: now,
    is_active: true,
    verified_at: now,
  }));

  const latamBankRows = LATAM_BANKS.map(b => ({
    user_id: userId,
    enterprise_id: enterpriseId,
    institution_name: b.institution,
    account_name: b.name,
    account_type: 'checking',
    last4: b.last4,
    currency: b.currency,
    current_balance: b.balance,
    balance_currency: b.currency,
    balance_as_of: now,
    is_active: true,
    verified_at: now,
    nickname: b.nickname,
    banking_provider: b.banking_provider,
  }));

  const { data: banks } = await supabase
    .from('bank_accounts')
    .insert([...bankRows, ...latamBankRows])
    .select('id, institution_name, currency');

  if (!banks?.length) return { bankAccountIds: [] };

  // Seed 20 fiat transactions over 90 days
  const usdBanks = banks.filter(b => b.currency === 'USD');
  const fiatTxns: any[] = [];
  const statuses = ['completed', 'completed', 'completed', 'completed', 'pending', 'failed'];

  for (let i = 0; i < 20; i++) {
    const isOnramp = Math.random() > 0.4;
    const bank = pick(usdBanks.length ? usdBanks : banks);
    const amount = rand(50000, 500000).toFixed(2);
    const feeRate = rand(0.0008, 0.0015);
    const fee = (parseFloat(amount) * feeRate).toFixed(2);
    const fiatAmount = isOnramp
      ? (parseFloat(amount) + parseFloat(fee)).toFixed(2)
      : (parseFloat(amount) - parseFloat(fee)).toFixed(2);

    fiatTxns.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      bank_account_id: bank.id,
      direction: isOnramp ? 'onramp' : 'offramp',
      crypto_token: pick(['USDC', 'USDT']),
      crypto_amount: amount,
      fiat_amount: fiatAmount,
      fiat_currency: 'USD',
      exchange_rate: isOnramp ? rand(0.998, 1.002).toFixed(6) : rand(0.998, 1.002).toFixed(6),
      fee_amount: fee,
      status: pick(statuses),
      provider: 'bridge_xyz',
      created_at: daysAgo(Math.floor(rand(1, 85))),
    });
  }

  // Seed 5 BRL/MXN fiat transactions
  const brlBanks = banks.filter(b => b.currency === 'BRL');
  const mxnBanks = banks.filter(b => b.currency === 'MXN');
  const latamTxnDefs = [
    { bank: pick(brlBanks.length ? brlBanks : banks), currency: 'BRL', direction: 'onramp', amountMin: 200000, amountMax: 800000, rate: rand(0.195, 0.205) },
    { bank: pick(brlBanks.length ? brlBanks : banks), currency: 'BRL', direction: 'offramp', amountMin: 100000, amountMax: 500000, rate: rand(0.195, 0.205) },
    { bank: pick(brlBanks.length ? brlBanks : banks), currency: 'BRL', direction: 'onramp', amountMin: 300000, amountMax: 1000000, rate: rand(0.195, 0.205) },
    { bank: pick(mxnBanks.length ? mxnBanks : banks), currency: 'MXN', direction: 'onramp', amountMin: 1000000, amountMax: 5000000, rate: rand(0.056, 0.060) },
    { bank: pick(mxnBanks.length ? mxnBanks : banks), currency: 'MXN', direction: 'offramp', amountMin: 500000, amountMax: 3000000, rate: rand(0.056, 0.060) },
  ];

  const latamTxns = latamTxnDefs.map(def => {
    const feeRate = rand(0.001, 0.002);
    const fiatAmount = rand(def.amountMin, def.amountMax).toFixed(2);
    const cryptoAmount = (parseFloat(fiatAmount) * def.rate).toFixed(2);
    const fee = (parseFloat(fiatAmount) * feeRate).toFixed(2);
    return {
      user_id: userId,
      enterprise_id: enterpriseId,
      bank_account_id: def.bank.id,
      direction: def.direction,
      crypto_token: pick(['USDC', 'USDT']),
      crypto_amount: cryptoAmount,
      fiat_amount: fiatAmount,
      fiat_currency: def.currency,
      exchange_rate: def.rate.toFixed(6),
      fee_amount: fee,
      status: pick(statuses),
      provider: 'belvo',
      created_at: daysAgo(Math.floor(rand(1, 85))),
    };
  });

  await supabase.from('fiat_transactions').insert([...fiatTxns, ...latamTxns]);

  return { bankAccountIds: banks.map(b => b.id) };
}
