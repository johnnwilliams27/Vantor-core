'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { actionNotificationEmail, alertEmail, infoEmail } from '@/lib/notifications/email-templates';
import { recommendationEmailHtml } from '@/lib/notifications/recommendation-email';
import { verifyEmailHtml } from '@/lib/email/templates/verify-email';
import { invitationEmailHtml } from '@/lib/email/templates/invitation';
import { monthlyBillEmailHtml } from '@/lib/email/templates/monthly-bill';

interface PreviewEntry {
  id: string;
  label: string;
  category: string;
  html: string;
}

const PREVIEWS: PreviewEntry[] = [
  {
    id: 'rec-pending',
    label: 'Recommendation Pending',
    category: 'Treasury AI',
    html: recommendationEmailHtml({
      id: 'abc-123',
      action: 'onramp',
      recommendedAmountUsd: '25000',
      totalBankBalanceUsd: '150000',
      obligationsInWindowUsd: '45000',
      safetyBufferTargetUsd: '67500',
      obligationLookaheadDays: 7,
      aiReasoning: '\u{1F4CA} Current Position\nYour fiat balance of $150,000 exceeds the safety buffer target of $67,500 by $82,500.\n\n\u{1F4A1} Reasoning\nWith $45,000 in obligations over the next 7 days and a 1.5x safety multiplier, you have significant surplus capital that could be earning yield.\n\n\u2705 Recommendation\nConvert $25,000 to USDC on Ethereum to optimize your treasury allocation.',
      stablecoinToken: 'USDC',
      stablecoinChain: 'ethereum',
      bankLabel: 'Chase ****4521',
      walletLabel: '0x1a2b...9f3c',
      status: 'pending_approval',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  },
  {
    id: 'rec-auto-executed',
    label: 'Recommendation Auto-Executed',
    category: 'Treasury AI',
    html: recommendationEmailHtml({
      id: 'def-456',
      action: 'onramp',
      recommendedAmountUsd: '5000',
      totalBankBalanceUsd: '80000',
      obligationsInWindowUsd: '20000',
      safetyBufferTargetUsd: '30000',
      obligationLookaheadDays: 7,
      aiReasoning: '\u{1F4CA} Current Position\nYour fiat balance of $80,000 has a surplus of $50,000 above the safety target.\n\n\u{1F4A1} Reasoning\nThe recommended amount of $5,000 is below your approval threshold, so this was automatically executed.\n\n\u2705 Recommendation\nConverted $5,000 to USDC on Ethereum.',
      stablecoinToken: 'USDC',
      stablecoinChain: 'ethereum',
      bankLabel: 'Chase ****4521',
      walletLabel: '0x1a2b...9f3c',
      status: 'auto_executed',
    }),
  },
  {
    id: 'rec-approved',
    label: 'Recommendation Approved',
    category: 'Treasury AI',
    html: recommendationEmailHtml({
      id: 'ghi-789',
      action: 'offramp',
      recommendedAmountUsd: '15000',
      totalBankBalanceUsd: '30000',
      obligationsInWindowUsd: '55000',
      safetyBufferTargetUsd: '82500',
      obligationLookaheadDays: 7,
      aiReasoning: '\u{1F4CA} Current Position\nYour fiat balance of $30,000 is below the safety buffer target of $82,500.\n\n\u{1F4A1} Reasoning\nUpcoming obligations require additional fiat liquidity.\n\n\u2705 Recommendation\nOff-ramp $15,000 USDC to cover upcoming obligations.',
      stablecoinToken: 'USDC',
      stablecoinChain: 'ethereum',
      bankLabel: 'Chase ****4521',
      walletLabel: '0x1a2b...9f3c',
      status: 'approved',
    }),
  },
  {
    id: 'rec-rejected',
    label: 'Recommendation Rejected',
    category: 'Treasury AI',
    html: recommendationEmailHtml({
      id: 'jkl-012',
      action: 'onramp',
      recommendedAmountUsd: '50000',
      totalBankBalanceUsd: '200000',
      obligationsInWindowUsd: '40000',
      safetyBufferTargetUsd: '60000',
      obligationLookaheadDays: 7,
      aiReasoning: '\u{1F4CA} Current Position\nLarge surplus of $140,000 detected above safety target.\n\n\u{1F4A1} Reasoning\nSignificant idle capital that could be earning yield.\n\n\u2705 Recommendation\nConvert $50,000 to USDC.',
      stablecoinToken: 'USDC',
      stablecoinChain: 'ethereum',
      bankLabel: 'Chase ****4521',
      walletLabel: '0x1a2b...9f3c',
      status: 'rejected',
    }),
  },
  {
    id: 'transfer-completed',
    label: 'Transfer Completed',
    category: 'Transactions',
    html: actionNotificationEmail({
      title: 'Transfer Completed',
      details: [
        { label: 'Amount', value: '2.5 ETH' },
        { label: 'From', value: '0x1a2b...9f3c' },
        { label: 'To', value: '0x4d5e...2a1b' },
        { label: 'Chain', value: 'Ethereum' },
        { label: 'Status', value: 'Completed' },
      ],
      ctaLabel: 'View Transaction',
      ctaHref: '/transactions',
    }),
  },
  {
    id: 'swap-completed',
    label: 'Swap Completed',
    category: 'Swaps',
    html: actionNotificationEmail({
      title: 'Swap Completed',
      details: [
        { label: 'From', value: '10,000 USDC' },
        { label: 'To', value: '10,015 USDT' },
        { label: 'Chain', value: 'Ethereum' },
        { label: 'Rate', value: '1.0015' },
      ],
      ctaLabel: 'View Swap',
      ctaHref: '/swaps',
    }),
  },
  {
    id: 'onramp-completed',
    label: 'On-Ramp Completed',
    category: 'Ramps',
    html: actionNotificationEmail({
      title: 'On-Ramp Completed',
      details: [
        { label: 'Fiat Amount', value: '$25,000' },
        { label: 'Crypto Received', value: '25,000 USDC' },
        { label: 'Chain', value: 'Ethereum' },
        { label: 'Fee', value: '$12.50' },
      ],
      ctaLabel: 'View Transaction',
      ctaHref: '/ramps',
    }),
  },
  {
    id: 'bridge-completed',
    label: 'Bridge Completed',
    category: 'Bridges',
    html: actionNotificationEmail({
      title: 'Bridge Completed',
      details: [
        { label: 'Token', value: 'USDC' },
        { label: 'Amount', value: '50,000' },
        { label: 'From Chain', value: 'Ethereum' },
        { label: 'To Chain', value: 'Solana' },
        { label: 'Bridge Fee', value: '$5.00' },
      ],
      ctaLabel: 'View Bridge',
      ctaHref: '/bridges',
    }),
  },
  {
    id: 'payment-sent',
    label: 'Payment Sent',
    category: 'Payments',
    html: actionNotificationEmail({
      title: 'Fiat Payment Sent',
      details: [
        { label: 'Amount', value: '$10,000' },
        { label: 'From', value: 'Chase ****4521' },
        { label: 'To', value: 'BoA ****8832' },
        { label: 'Status', value: 'Settled' },
      ],
      ctaLabel: 'View Payment',
      ctaHref: '/payments',
    }),
  },
  {
    id: 'yield-deposit',
    label: 'Yield Deposit Confirmed',
    category: 'Yield',
    html: actionNotificationEmail({
      title: 'Yield Deposit Confirmed',
      details: [
        { label: 'Protocol', value: 'Aave V3' },
        { label: 'Token', value: 'USDC' },
        { label: 'Amount', value: '100,000' },
        { label: 'APY', value: '4.2%' },
      ],
      ctaLabel: 'View Position',
      ctaHref: '/yield',
    }),
  },
  {
    id: 'yield-withdrawal',
    label: 'Yield Withdrawal Confirmed',
    category: 'Yield',
    html: actionNotificationEmail({
      title: 'Yield Withdrawal Confirmed',
      details: [
        { label: 'Protocol', value: 'Aave V3' },
        { label: 'Token', value: 'USDC' },
        { label: 'Deposited', value: '50,000' },
        { label: 'Withdrawn', value: '51,247.83' },
        { label: 'Yield Earned', value: '+$1,247.83 (+2.50%)' },
        { label: 'Duration', value: '217 days' },
      ],
      ctaLabel: 'View Position',
      ctaHref: '/yield',
    }),
  },
  {
    id: 'scheduled-swap',
    label: 'Scheduled Swap Executed',
    category: 'Scheduled Ops',
    html: actionNotificationEmail({
      title: 'Scheduled Swap Executed',
      details: [
        { label: 'From', value: '5,000 USDC' },
        { label: 'To', value: '5,008 USDT' },
        { label: 'Chain', value: 'Ethereum' },
      ],
      ctaLabel: 'View Details',
      ctaHref: '/swaps',
      scheduledDeviation: { toleranceBps: 50, actualBps: 3 },
    }),
  },
  {
    id: 'sanctions-alert',
    label: 'Sanctions Alert',
    category: 'Compliance',
    html: alertEmail({
      title: 'Sanctions Screening Alert',
      description: 'A transaction to address 0x4d5e...2a1b has been flagged by Chainalysis KYT for potential sanctions exposure. Immediate review required.',
      ctaLabel: 'Review in Compliance',
      ctaHref: '/compliance',
      severity: 'error',
    }),
  },
  {
    id: 'invoice-overdue',
    label: 'Invoice Overdue',
    category: 'Invoices',
    html: alertEmail({
      title: 'Invoice Overdue',
      description: 'Invoice #INV-2026-0042 from Acme Corp ($12,500) is 3 days past due.',
      ctaLabel: 'View Invoice',
      ctaHref: '/invoices',
      severity: 'warning',
    }),
  },
  {
    id: 'scheduled-op-failed',
    label: 'Scheduled Op Failed',
    category: 'Scheduled Ops',
    html: alertEmail({
      title: 'Scheduled Operation Failed',
      description: 'A scheduled swap of 10,000 USDC to USDT failed: insufficient liquidity.',
      ctaLabel: 'View Details',
      ctaHref: '/swaps',
      severity: 'error',
    }),
  },
  {
    id: 'scheduled-op-flagged',
    label: 'Scheduled Op Flagged',
    category: 'Scheduled Ops',
    html: alertEmail({
      title: 'Scheduled Operation Needs Authorization',
      description: 'A scheduled ramp of $50,000 has a rate deviation of 75 bps (tolerance: 50 bps). Manual authorization required within 24 hours.',
      ctaLabel: 'Review & Authorize',
      ctaHref: '/swaps',
      severity: 'warning',
    }),
  },
  {
    id: 'payment-failed',
    label: 'Billing Payment Failed',
    category: 'Billing',
    html: alertEmail({
      title: 'Payment Failed',
      description: 'Your monthly billing payment of $299 failed. Please update your payment method.',
      ctaLabel: 'Update Payment Method',
      ctaHref: '/settings/billing',
      severity: 'error',
    }),
  },
  {
    id: 'wallet-connected',
    label: 'Wallet Connected',
    category: 'Wallets & Accounts',
    html: infoEmail({
      title: 'Wallet Connected',
      description: 'A new Ethereum wallet (0x1a2b...9f3c) was connected to your organization.',
      ctaLabel: 'View Wallets',
      ctaHref: '/wallets',
    }),
  },
  {
    id: 'member-invited',
    label: 'Member Invited',
    category: 'Team',
    html: infoEmail({
      title: 'Team Member Invited',
      description: 'john@example.com was invited to join your organization as an Accountant.',
      ctaLabel: 'Manage Team',
      ctaHref: '/settings/accounts',
    }),
  },
  {
    id: 'treasury-rule-created',
    label: 'Treasury Rule Created',
    category: 'Treasury Rules',
    html: infoEmail({
      title: 'Treasury Rule Created',
      description: 'A new treasury rule "Conservative Buffer" was created with a 2.0x safety multiplier.',
      ctaLabel: 'View Rules',
      ctaHref: '/treasury',
    }),
  },
  {
    id: 'kyc-approved',
    label: 'KYC Approved',
    category: 'KYC / KYB',
    html: infoEmail({
      title: 'KYC Verification Approved',
      description: 'Your identity verification has been approved. You now have full access to Vantor.',
      ctaLabel: 'View Profile',
      ctaHref: '/settings/accounts',
    }),
  },
  {
    id: 'verify-email',
    label: 'Verify Email',
    category: 'Authentication',
    html: verifyEmailHtml({ fullName: 'John Williams', verifyUrl: 'https://app.vantor.xyz/verify?token=abc123' }),
  },
  {
    id: 'invitation',
    label: 'Team Invitation',
    category: 'Authentication',
    html: invitationEmailHtml({ inviterName: 'John Williams', signupUrl: 'https://app.vantor.xyz/register?invite=abc123' }),
  },
  {
    id: 'monthly-bill',
    label: 'Monthly Bill',
    category: 'Billing (Existing)',
    html: monthlyBillEmailHtml({ enterpriseName: 'Acme Corp', billingPeriod: 'March 2026', totalAmount: '$1,247.50' }),
  },
];

const categories = Array.from(new Set(PREVIEWS.map((p) => p.category)));

export default function EmailPreviewsPage() {
  const [selected, setSelected] = useState(PREVIEWS[0].id);
  const preview = PREVIEWS.find((p) => p.id === selected);

  if (process.env.NODE_ENV !== 'development') {
    return <div className="p-8 text-muted-foreground">Not available in production.</div>;
  }

  return (
    <div className="flex h-screen bg-background">
      <div className="w-72 border-r border-border overflow-y-auto bg-muted/20">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold text-foreground">Email Previews</h1>
          <p className="text-xs text-muted-foreground mt-1">Dev only — {PREVIEWS.length} templates</p>
        </div>
        {categories.map((cat) => (
          <div key={cat}>
            <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
              {cat}
            </div>
            {PREVIEWS.filter((p) => p.category === cat).map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={cn(
                  'w-full text-left px-4 py-2 text-sm transition-colors border-b border-border/30',
                  selected === p.id
                    ? 'bg-[#19595b]/10 text-[#19595b] font-medium dark:bg-teal-500/20 dark:text-teal-300'
                    : 'text-foreground hover:bg-muted/40'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex-1 bg-gray-100 dark:bg-gray-900 p-6">
        {preview && (
          <iframe
            srcDoc={preview.html}
            title={preview.label}
            className="w-full h-full rounded-lg border border-border shadow-sm bg-white"
          />
        )}
      </div>
    </div>
  );
}
