import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import type { UserRole } from './types';
import { hasRole } from '@/lib/auth/rbac';
import { buildTreasurySnapshot, collectObligations } from '@/lib/treasury/rules-engine';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getERPAdapter, decryptCredentials } from '@/lib/erp/factory';
import { executePayment } from '@/lib/payments/executor';
import { writeAuditLog } from '@/lib/audit/logger';

export interface ToolContext {
  supabase: SupabaseClient;
  userId: string;
  userRole: UserRole;
  enterpriseId: string | null;
}

type ToolHandler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

interface AgentTool {
  name: string;
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  minRole: UserRole;
  handler: ToolHandler;
}

// ---------------------------------------------------------------------------
// Read-only tools (all roles)
// ---------------------------------------------------------------------------

const getTreasuryOverview: AgentTool = {
  name: 'get_treasury_overview',
  description: 'Get a full treasury overview including total AUM, bank account balances, and crypto wallet positions.',
  input_schema: { type: 'object', properties: {}, required: [] },
  minRole: 'auditor',
  async handler(_input, ctx) {
    const snapshot = await buildTreasurySnapshot(ctx.supabase, ctx.userId, undefined, ctx.enterpriseId);
    return {
      totalAumUsd: snapshot.totalBankBalanceUsd + snapshot.totalCryptoBalanceUsd,
      totalBankBalanceUsd: snapshot.totalBankBalanceUsd,
      totalCryptoBalanceUsd: snapshot.totalCryptoBalanceUsd,
      bankAccounts: snapshot.bankAccounts,
      cryptoPositions: snapshot.cryptoPositions,
    };
  },
};

const getWallets: AgentTool = {
  name: 'get_wallets',
  description: 'List all connected crypto wallets with their token balances.',
  input_schema: { type: 'object', properties: {}, required: [] },
  minRole: 'auditor',
  async handler(_input, ctx) {
    const { data, error } = await ctx.supabase
      .from('wallets')
      .select('id, chain, address, label, wallet_balances(token, balance, usd_value)')
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId);
    if (error) throw new Error(error.message);
    return data;
  },
};

const getBankAccounts: AgentTool = {
  name: 'get_bank_accounts',
  description: 'List all connected bank accounts with their fiat balances.',
  input_schema: { type: 'object', properties: {}, required: [] },
  minRole: 'auditor',
  async handler(_input, ctx) {
    const { data, error } = await ctx.supabase
      .from('bank_accounts')
      .select('id, institution_name, account_name, last4, current_balance, balance_as_of, currency')
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .eq('is_active', true);
    if (error) throw new Error(error.message);
    return data;
  },
};

const getInvoices: AgentTool = {
  name: 'get_invoices',
  description: 'List invoices, optionally filtered by status (draft, pending, paid, overdue, cancelled).',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['draft', 'pending', 'paid', 'overdue', 'cancelled'],
        description: 'Filter by invoice status',
      },
      limit: { type: 'number', description: 'Max number of invoices to return (default 20)' },
    },
    required: [],
  },
  minRole: 'auditor',
  async handler(input, ctx) {
    let q = ctx.supabase
      .from('invoices')
      .select('id, invoice_number, counterparty_name, amount, currency, status, due_date, created_at')
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .order('created_at', { ascending: false })
      .limit((input.limit as number) ?? 20);
    if (input.status) q = q.eq('status', input.status as string);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
};

const getPayments: AgentTool = {
  name: 'get_payments',
  description: 'List recent payments, optionally filtered by status (pending, processing, completed, failed).',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'processing', 'completed', 'failed'],
        description: 'Filter by payment status',
      },
      limit: { type: 'number', description: 'Max number of payments to return (default 20)' },
    },
    required: [],
  },
  minRole: 'auditor',
  async handler(input, ctx) {
    let q = ctx.supabase
      .from('payments')
      .select('id, to_address, chain, token, amount, status, memo, created_at, executed_at, tx_hash')
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .order('created_at', { ascending: false })
      .limit((input.limit as number) ?? 20);
    if (input.status) q = q.eq('status', input.status as string);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
};

const getTransactions: AgentTool = {
  name: 'get_transactions',
  description: 'List recent on-chain transactions.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max number of transactions to return (default 20)' },
    },
    required: [],
  },
  minRole: 'auditor',
  async handler(input, ctx) {
    const { data, error } = await ctx.supabase
      .from('transactions')
      .select('id, chain, tx_hash, token, amount, direction, counterparty, status, confirmed_at')
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .order('confirmed_at', { ascending: false })
      .limit((input.limit as number) ?? 20);
    if (error) throw new Error(error.message);
    return data;
  },
};

const getObligations: AgentTool = {
  name: 'get_obligations',
  description: 'Get upcoming financial obligations (invoices due, scheduled payments) within a time window.',
  input_schema: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Number of days to look ahead (default 30)' },
    },
    required: [],
  },
  minRole: 'auditor',
  async handler(input, ctx) {
    const days = (input.days as number) ?? 30;
    const obligations = await collectObligations(ctx.supabase, ctx.userId, days, ctx.enterpriseId);
    return { days, obligations, totalUsd: obligations.reduce((s, o) => s + o.amountUsd, 0) };
  },
};

const getForecast: AgentTool = {
  name: 'get_forecast',
  description: 'Get cash flow forecast data.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max number of forecast entries (default 30)' },
    },
    required: [],
  },
  minRole: 'auditor',
  async handler(input, ctx) {
    const { data, error } = await ctx.supabase
      .from('cash_flow_forecasts')
      .select('*')
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .order('forecast_date', { ascending: true })
      .limit((input.limit as number) ?? 30);
    if (error) throw new Error(error.message);
    return data;
  },
};

const getRecommendations: AgentTool = {
  name: 'get_recommendations',
  description: 'Get AI treasury recommendation history.',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'approved', 'rejected', 'executed'],
        description: 'Filter by recommendation status',
      },
      limit: { type: 'number', description: 'Max number of recommendations (default 10)' },
    },
    required: [],
  },
  minRole: 'auditor',
  async handler(input, ctx) {
    let q = ctx.supabase
      .from('treasury_recommendations')
      .select('*')
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .order('created_at', { ascending: false })
      .limit((input.limit as number) ?? 10);
    if (input.status) q = q.eq('status', input.status as string);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
};

// ---------------------------------------------------------------------------
// Accountant+ tools
// ---------------------------------------------------------------------------

const syncErpInvoices: AgentTool = {
  name: 'sync_erp_invoices',
  description: 'Sync invoices from a connected ERP system.',
  input_schema: {
    type: 'object',
    properties: {
      erpConfigId: { type: 'string', description: 'ERP configuration ID to sync from' },
    },
    required: ['erpConfigId'],
  },
  minRole: 'accountant',
  async handler(input, ctx) {
    const { data: config, error } = await ctx.supabase
      .from('erp_configurations')
      .select('*')
      .eq('id', input.erpConfigId as string)
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .single();
    if (error || !config) throw new Error('ERP configuration not found');

    const creds = decryptCredentials(config.credentials_enc as string);
    const adapter = getERPAdapter(config.provider, creds);
    const invoices = await adapter.fetchInvoices();

    // Upsert invoices into DB
    let synced = 0;
    for (const inv of invoices) {
      const { error: upsertErr } = await ctx.supabase.from('invoices').upsert({
        user_id: ctx.userId,
        erp_config_id: config.id,
        erp_invoice_id: inv.id,
        invoice_number: inv.invoiceNumber,
        counterparty_name: inv.vendorId,
        amount: String(inv.amount),
        currency: inv.token,
        status: 'pending',
        due_date: inv.dueDate ?? null,
        line_items: [],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'erp_config_id,erp_invoice_id', ignoreDuplicates: false });
      if (!upsertErr) synced++;
    }

    await writeAuditLog({ userId: ctx.userId, action: 'erp_sync', entityType: 'erp_configuration', entityId: config.id as string, details: { synced } });
    return { synced, total: invoices.length };
  },
};

const createInvoice: AgentTool = {
  name: 'create_invoice',
  description: 'Create a manual invoice.',
  input_schema: {
    type: 'object',
    properties: {
      counterpartyName: { type: 'string', description: 'Vendor or client name' },
      amount: { type: 'string', description: 'Invoice amount as a string number' },
      currency: { type: 'string', description: 'Currency code (e.g. USD, USDC)' },
      dueDate: { type: 'string', description: 'Due date in ISO format (YYYY-MM-DD)' },
      memo: { type: 'string', description: 'Optional description or memo' },
    },
    required: ['counterpartyName', 'amount', 'currency', 'dueDate'],
  },
  minRole: 'accountant',
  async handler(input, ctx) {
    const { data, error } = await ctx.supabase
      .from('invoices')
      .insert({
        user_id: ctx.userId,
        counterparty_name: input.counterpartyName as string,
        amount: input.amount as string,
        currency: input.currency as string,
        due_date: input.dueDate as string,
        memo: input.memo as string | undefined,
        status: 'pending',
        line_items: [],
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({ userId: ctx.userId, action: 'invoice_create', entityType: 'invoice', entityId: data.id as string, details: { amount: input.amount, currency: input.currency } });
    return data;
  },
};

// ---------------------------------------------------------------------------
// Treasury manager tools
// ---------------------------------------------------------------------------

const createPayment: AgentTool = {
  name: 'create_payment',
  description: 'Create and execute a crypto payment. Always confirm with the user before calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      fromWalletId: { type: 'string', description: 'Source wallet UUID' },
      toAddress: { type: 'string', description: 'Destination wallet address' },
      chain: { type: 'string', enum: ['ethereum', 'solana'], description: 'Blockchain network' },
      token: { type: 'string', enum: ['USDC', 'USDT', 'PYUSD'], description: 'Stablecoin token' },
      amount: { type: 'string', description: 'Amount to send as a string number' },
      memo: { type: 'string', description: 'Optional payment memo' },
      invoiceId: { type: 'string', description: 'Optional linked invoice UUID' },
    },
    required: ['fromWalletId', 'toAddress', 'chain', 'token', 'amount'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    // Insert payment record
    const { data: payment, error } = await ctx.supabase
      .from('payments')
      .insert({
        user_id: ctx.userId,
        from_wallet_id: input.fromWalletId as string,
        to_address: input.toAddress as string,
        chain: input.chain as string,
        token: input.token as string,
        amount: input.amount as string,
        memo: input.memo as string | undefined,
        invoice_id: input.invoiceId as string | undefined,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Execute the payment
    const result = await executePayment(payment as any);
    if (result.error) throw new Error(result.error);
    return { paymentId: payment.id, txHash: result.txHash, status: 'completed' };
  },
};

const schedulePayment: AgentTool = {
  name: 'schedule_payment',
  description: 'Schedule a future payment. Always confirm with the user before calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      fromWalletId: { type: 'string', description: 'Source wallet UUID' },
      toAddress: { type: 'string', description: 'Destination wallet address' },
      chain: { type: 'string', enum: ['ethereum', 'solana'], description: 'Blockchain network' },
      token: { type: 'string', enum: ['USDC', 'USDT', 'PYUSD'], description: 'Stablecoin token' },
      amount: { type: 'string', description: 'Amount to send' },
      scheduledFor: { type: 'string', description: 'ISO timestamp for when to send the payment' },
      memo: { type: 'string', description: 'Optional memo' },
    },
    required: ['fromWalletId', 'toAddress', 'chain', 'token', 'amount', 'scheduledFor'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const { data, error } = await ctx.supabase
      .from('payments')
      .insert({
        user_id: ctx.userId,
        from_wallet_id: input.fromWalletId as string,
        to_address: input.toAddress as string,
        chain: input.chain as string,
        token: input.token as string,
        amount: input.amount as string,
        memo: input.memo as string | undefined,
        scheduled_for: input.scheduledFor as string,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({ userId: ctx.userId, action: 'payment_schedule', entityType: 'payment', entityId: data.id as string, details: { amount: input.amount, scheduledFor: input.scheduledFor } });
    return { paymentId: data.id, status: 'scheduled', scheduledFor: input.scheduledFor };
  },
};

const getRampQuote: AgentTool = {
  name: 'get_ramp_quote',
  description: 'Get a quote for an on-ramp (fiat → crypto) or off-ramp (crypto → fiat) transaction.',
  input_schema: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['onramp', 'offramp'], description: 'Direction: onramp = fiat→crypto, offramp = crypto→fiat' },
      cryptoToken: { type: 'string', enum: ['USDC', 'USDT', 'PYUSD'], description: 'Stablecoin token' },
      fiatCurrency: { type: 'string', description: 'Fiat currency code (e.g. USD, EUR)' },
      cryptoAmount: { type: 'number', description: 'Amount in crypto (provide either this or fiatAmount)' },
      fiatAmount: { type: 'number', description: 'Amount in fiat (provide either this or cryptoAmount)' },
    },
    required: ['direction', 'cryptoToken', 'fiatCurrency'],
  },
  minRole: 'treasury_manager',
  async handler(input, _ctx) {
    const adapter = getBankingAdapter();
    const quote = await adapter.getRampQuote({
      direction: input.direction as 'onramp' | 'offramp',
      cryptoToken: input.cryptoToken as 'USDC' | 'USDT' | 'PYUSD',
      fiatCurrency: input.fiatCurrency as string,
      cryptoAmount: input.cryptoAmount as number | undefined,
      fiatAmount: input.fiatAmount as number | undefined,
    });
    return quote;
  },
};

const executeRamp: AgentTool = {
  name: 'execute_ramp',
  description: 'Execute an on-ramp or off-ramp transaction via Bridge. Always confirm with the user before calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['onramp', 'offramp'] },
      cryptoToken: { type: 'string', description: 'Stablecoin token (USDC, USDT, PYUSD)' },
      cryptoAmount: { type: 'number', description: 'Crypto amount from quote' },
      fiatAmount: { type: 'number', description: 'Fiat amount from quote' },
      fiatCurrency: { type: 'string', description: 'Fiat currency code' },
      exchangeRate: { type: 'number', description: 'Exchange rate from quote' },
      feeAmount: { type: 'number', description: 'Fee amount from quote' },
      bankAccountRef: { type: 'string', description: 'Bank account reference ID' },
    },
    required: ['direction', 'cryptoToken', 'cryptoAmount', 'fiatAmount', 'fiatCurrency', 'exchangeRate', 'feeAmount'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const adapter = getBankingAdapter();
    const result = await adapter.executeRamp({
      direction: input.direction as 'onramp' | 'offramp',
      cryptoToken: input.cryptoToken as string,
      cryptoAmount: input.cryptoAmount as number,
      fiatAmount: input.fiatAmount as number,
      fiatCurrency: input.fiatCurrency as string,
      exchangeRate: input.exchangeRate as number,
      feeAmount: input.feeAmount as number,
      bankAccountRef: input.bankAccountRef as string | undefined,
    });
    const action = (input.direction === 'onramp' ? 'onramp_execute' : 'offramp_execute') as 'onramp_execute' | 'offramp_execute';
    await writeAuditLog({ userId: ctx.userId, action, entityType: 'ramp', entityId: result.providerTransactionId, details: result as unknown as Record<string, unknown> });
    return result;
  },
};

const getSwapQuote: AgentTool = {
  name: 'get_swap_quote',
  description: 'Get a DEX swap quote for exchanging one token for another.',
  input_schema: {
    type: 'object',
    properties: {
      chain: { type: 'string', enum: ['ethereum', 'solana'], description: 'Blockchain network' },
      fromToken: { type: 'string', description: 'Token to sell (e.g. USDC)' },
      toToken: { type: 'string', description: 'Token to buy (e.g. USDT)' },
      amount: { type: 'string', description: 'Amount of fromToken to sell' },
      walletAddress: { type: 'string', description: 'Wallet address executing the swap' },
    },
    required: ['chain', 'fromToken', 'toToken', 'amount', 'walletAddress'],
  },
  minRole: 'treasury_manager',
  async handler(input, _ctx) {
    const chain = input.chain as string;
    if (chain === 'solana') {
      const { getJupiterQuote } = await import('@/lib/swaps/jupiter');
      return await getJupiterQuote(
        input.fromToken as any,
        input.toToken as any,
        input.amount as string
      );
    } else {
      const { getOneInchQuote } = await import('@/lib/swaps/oneinch');
      return await getOneInchQuote(
        input.fromToken as any,
        input.toToken as any,
        input.amount as string,
        input.walletAddress as string
      );
    }
  },
};

const executeSwap: AgentTool = {
  name: 'execute_swap',
  description: 'Execute a DEX token swap. Always confirm with the user before calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      chain: { type: 'string', enum: ['ethereum', 'solana'], description: 'Blockchain network' },
      fromToken: { type: 'string', description: 'Token to sell' },
      toToken: { type: 'string', description: 'Token to buy' },
      amount: { type: 'string', description: 'Amount to sell' },
      walletId: { type: 'string', description: 'Wallet UUID' },
      walletAddress: { type: 'string', description: 'Wallet address' },
      quoteId: { type: 'string', description: 'Optional quote ID from get_swap_quote' },
    },
    required: ['chain', 'fromToken', 'toToken', 'amount', 'walletId', 'walletAddress'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const chain = input.chain as string;
    let result: unknown;
    if (chain === 'solana') {
      // Get a fresh quote first to get quoteData for execution
      const { getJupiterQuote, executeJupiterSwap } = await import('@/lib/swaps/jupiter');
      const quote = await getJupiterQuote(
        input.fromToken as any,
        input.toToken as any,
        input.amount as string
      );
      result = await executeJupiterSwap(
        (quote as any).quoteData as Record<string, unknown>,
        input.walletAddress as string
      );
    } else {
      const { getOneInchQuote, executeOneInchSwap } = await import('@/lib/swaps/oneinch');
      const quote = await getOneInchQuote(
        input.fromToken as any,
        input.toToken as any,
        input.amount as string,
        input.walletAddress as string
      );
      result = await executeOneInchSwap(
        (quote as any).quoteData as Record<string, unknown>,
        input.walletAddress as string
      );
    }

    // Record swap in DB
    await ctx.supabase.from('swaps').insert({
      user_id: ctx.userId,
      wallet_id: input.walletId as string,
      chain: input.chain as string,
      from_token: input.fromToken as string,
      to_token: input.toToken as string,
      from_amount: input.amount as string,
      status: 'completed',
    });

    await writeAuditLog({ userId: ctx.userId, action: 'swap_execute', entityType: 'swap', entityId: input.walletId as string, details: { chain, fromToken: input.fromToken, toToken: input.toToken, amount: input.amount } });
    return result;
  },
};

const approveRecommendation: AgentTool = {
  name: 'approve_recommendation',
  description: 'Approve a pending AI treasury recommendation.',
  input_schema: {
    type: 'object',
    properties: {
      recommendationId: { type: 'string', description: 'Recommendation UUID to approve' },
    },
    required: ['recommendationId'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const { data, error } = await ctx.supabase
      .from('treasury_recommendations')
      .update({ status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString() })
      .eq('id', input.recommendationId as string)
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({ userId: ctx.userId, action: 'treasury_recommendation_approve', entityType: 'treasury_recommendation', entityId: data.id as string, details: {} });
    return { status: 'approved', recommendation: data };
  },
};

const rejectRecommendation: AgentTool = {
  name: 'reject_recommendation',
  description: 'Reject a pending AI treasury recommendation.',
  input_schema: {
    type: 'object',
    properties: {
      recommendationId: { type: 'string', description: 'Recommendation UUID to reject' },
      reason: { type: 'string', description: 'Optional reason for rejection' },
    },
    required: ['recommendationId'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const { data, error } = await ctx.supabase
      .from('treasury_recommendations')
      .update({ status: 'rejected', rejected_at: new Date().toISOString(), rejection_reason: input.reason as string | undefined })
      .eq('id', input.recommendationId as string)
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({ userId: ctx.userId, action: 'treasury_recommendation_reject', entityType: 'treasury_recommendation', entityId: data.id as string, details: { reason: input.reason } });
    return { status: 'rejected', recommendation: data };
  },
};

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Yield tools
// ---------------------------------------------------------------------------

const getYieldPositions: AgentTool = {
  name: 'get_yield_positions',
  description: 'List all active DeFi yield positions with current values, APY, and accrued yield.',
  input_schema: { type: 'object', properties: {} },
  minRole: 'auditor',
  async handler(_input, ctx) {
    const { data } = await ctx.supabase
      .from('yield_positions')
      .select('*')
      .eq('user_id', ctx.userId)
      .eq('enterprise_id', ctx.enterpriseId)
      .eq('is_active', true)
      .order('current_value_usd', { ascending: false });
    return data ?? [];
  },
};

const yieldDeposit: AgentTool = {
  name: 'yield_deposit',
  description: 'Deposit stablecoins into a DeFi yield protocol (Aave, Morpho, Kamino, etc.). Always confirm with the user before calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      protocol: { type: 'string', description: 'Protocol ID (aave_v3, morpho, kamino, ondo, etc.)' },
      token: { type: 'string', enum: ['USDC', 'USDT', 'PYUSD'], description: 'Stablecoin to deposit' },
      amount: { type: 'string', description: 'Amount to deposit' },
      walletAddress: { type: 'string', description: 'Wallet address' },
      chain: { type: 'string', enum: ['ethereum', 'solana'], description: 'Blockchain' },
    },
    required: ['protocol', 'token', 'amount', 'walletAddress', 'chain'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const res = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/yield/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-user-id': ctx.userId, 'x-agent-enterprise-id': ctx.enterpriseId ?? '' },
      body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Yield deposit failed');
    return json.data;
  },
};

const yieldWithdraw: AgentTool = {
  name: 'yield_withdraw',
  description: 'Withdraw stablecoins from a DeFi yield position. Always confirm with the user before calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      positionId: { type: 'string', description: 'Yield position UUID' },
      amount: { type: 'string', description: 'Amount to withdraw' },
      walletAddress: { type: 'string', description: 'Wallet address to receive funds' },
    },
    required: ['positionId', 'amount', 'walletAddress'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const res = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/yield/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-user-id': ctx.userId, 'x-agent-enterprise-id': ctx.enterpriseId ?? '' },
      body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Yield withdrawal failed');
    return json.data;
  },
};

const withdrawAndOfframp: AgentTool = {
  name: 'withdraw_and_offramp',
  description: 'Withdraw from a yield position AND off-ramp to fiat (USD, EUR, or GBP) in a single operation. Use this when the user needs to convert yield earnings to fiat. Always confirm with the user before calling.',
  input_schema: {
    type: 'object',
    properties: {
      positionId: { type: 'string', description: 'Yield position UUID' },
      amount: { type: 'string', description: 'Amount to withdraw and off-ramp' },
      walletAddress: { type: 'string', description: 'Wallet address' },
      bankAccountId: { type: 'string', description: 'Destination bank account UUID' },
      fiatCurrency: { type: 'string', enum: ['USD', 'EUR', 'GBP'], description: 'Target fiat currency' },
    },
    required: ['positionId', 'amount', 'walletAddress', 'bankAccountId', 'fiatCurrency'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const res = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/treasury/withdraw-and-offramp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-user-id': ctx.userId, 'x-agent-enterprise-id': ctx.enterpriseId ?? '' },
      body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Withdraw and off-ramp failed');
    return json.data;
  },
};

const ALL_TOOLS: AgentTool[] = [
  // Read-only (all roles)
  getTreasuryOverview,
  getWallets,
  getBankAccounts,
  getInvoices,
  getPayments,
  getTransactions,
  getObligations,
  getForecast,
  getRecommendations,
  // Accountant+
  syncErpInvoices,
  createInvoice,
  // Treasury manager only
  createPayment,
  schedulePayment,
  getRampQuote,
  executeRamp,
  getSwapQuote,
  executeSwap,
  approveRecommendation,
  rejectRecommendation,
  // Yield tools
  getYieldPositions,
  yieldDeposit,
  yieldWithdraw,
  withdrawAndOfframp,
];

/** Return Anthropic tool definitions filtered by role */
export function getToolsForRole(userRole: UserRole): Anthropic.Tool[] {
  return ALL_TOOLS.filter((t) => hasRole(userRole, t.minRole)).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/** Dispatch a tool call — checks role then executes handler */
export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (!hasRole(ctx.userRole, tool.minRole)) {
    throw new Error(`Tool '${name}' requires role '${tool.minRole}' — your role is '${ctx.userRole}'`);
  }
  return tool.handler(input, ctx);
}
