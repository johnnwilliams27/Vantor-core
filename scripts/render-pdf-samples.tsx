/**
 * Render sample PDFs for every migrated surface using realistic dummy
 * data. Output lands in `./tmp/*.pdf` so the user can open each one
 * locally to review the Stage 7 style-guide migration.
 *
 *   npx tsx scripts/render-pdf-samples.tsx
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';

import '../src/lib/export/fonts';
import { TableExportPdf } from '../src/lib/export/pdf';
import { InvoicePdf, type InvoiceData } from '../src/lib/billing/invoice-pdf';
import { TreasuryReportPdf } from '../src/lib/treasury/report-pdf';
import type { ReportData } from '../src/lib/treasury/report';
import { AnalyticsReportPdf } from '../src/lib/analytics/report-pdf';
import type { ViewResult } from '../src/lib/analytics/types';

const OUT = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(OUT, { recursive: true });

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

async function write(name: string, element: React.ReactElement) {
  const buffer = await renderToBuffer(element);
  const p = path.join(OUT, name);
  fs.writeFileSync(p, buffer);
  console.log(`  ${name}  (${(buffer.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log('\nRendering sample PDFs → ' + OUT);

  // 1. Generic table export (used by CSV/PDF export everywhere)
  const tableRows: string[][] = Array.from({ length: 22 }, (_, i) => [
    `2026-04-${String(12 - (i % 12)).padStart(2, '0')}`,
    ['Transfer', 'Off-ramp', 'On-ramp', 'Swap', 'Yield deposit'][i % 5],
    usd(10_000 + (i * 8_734) % 450_000),
    ['USDC', 'USDT', 'PYUSD'][i % 3],
    ['completed', 'pending', 'completed', 'completed', 'failed'][i % 5],
    ['Ops', 'Treasury', 'Finance', 'Payroll'][i % 4],
  ]);

  await write(
    '01-table-export.pdf',
    <TableExportPdf
      title="All Activity"
      generatedAt="Apr 13, 2026 09:21"
      orientation="portrait"
      columns={[
        { header: 'Date', width: '14%' },
        { header: 'Type', width: '16%' },
        { header: 'Amount', width: '18%' },
        { header: 'Asset', width: '12%' },
        { header: 'Status', width: '18%' },
        { header: 'Desk', width: '22%' },
      ]}
      rows={tableRows}
    />,
  );

  // 2. Monthly invoice
  const invoice: InvoiceData = {
    enterpriseName: 'Northwind Capital Partners, LP',
    billingPeriod: 'March 2026',
    tierName: 'Scale',
    subscriptionCost: 2_499,
    erpAddons: 2,
    erpAddonCost: 400,
    rampCount: 42,
    rampFees: 1_260,
    swapCount: 18,
    swapFees: 540,
    bridgeCount: 6,
    bridgeFees: 180,
    transferCount: 31,
    transferFees: 310,
    paymentCount: 9,
    paymentFees: 225,
    cardLast4: '4242',
  };
  await write('02-invoice.pdf', <InvoicePdf data={invoice} />);

  // 3. Treasury report
  const treasury: ReportData = {
    period: { from: '2026-03-01', to: '2026-03-31' },
    summary: {
      avgBankBalanceUsd: 4_820_000,
      avgCryptoBalanceUsd: 12_350_000,
      totalOnrampUsd: 3_200_000,
      totalOfframpUsd: 1_750_000,
      netRampUsd: 1_450_000,
      totalFeesUsd: 2_700,
      recommendationCount: 14,
      executedCount: 9,
      avgObligationCoverageRatio: 1.82,
    },
    balanceHistory: Array.from({ length: 31 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      bankUsd: 4_500_000 + Math.sin(i / 3) * 600_000,
      cryptoUsd: 12_000_000 + Math.cos(i / 4) * 900_000,
    })),
    recommendationOutcomes: Array.from({ length: 8 }, (_, i) => ({
      id: `rec_${i}`,
      user_id: 'u1',
      created_at: `2026-03-${String((i + 1) * 3).padStart(2, '0')}T09:00:00Z`,
      action: ['offramp', 'onramp', 'swap', 'yield_deposit'][i % 4],
      recommended_amount_usd: String(50_000 + i * 25_000),
      status: ['executed', 'approved', 'denied', 'pending'][i % 4],
      ai_reasoning:
        'Coverage ratio below 1.5×; recommend moving idle stablecoin to operating bank account to meet Thursday payroll obligation with 0.6× buffer.',
      // the rest of AiRecommendation fields aren't read by the PDF
    } as any)),
    obligationCoverageByWeek: [],
    rampSummary: Array.from({ length: 10 }, (_, i) => ({
      id: `ramp_${i}`,
      user_id: 'u1',
      created_at: `2026-03-${String(i * 3 + 1).padStart(2, '0')}T12:00:00Z`,
      direction: i % 2 === 0 ? 'onramp' : 'offramp',
      fiat_amount: String(100_000 + i * 40_000),
      fiat_currency: ['USD', 'EUR', 'GBP'][i % 3],
      status: ['completed', 'pending', 'completed'][i % 3],
    } as any)),
  };
  await write('03-treasury-report.pdf', <TreasuryReportPdf data={treasury} />);

  // 4. Analytics report (KPI + line + bar + table)
  const analytics: ViewResult[] = [
    {
      view: { slug: 'treasury_summary', label: 'Treasury Summary', chartType: 'kpi' },
      query: { from: '2026-03-01', to: '2026-03-31' },
      scalar: {
        avg_bank_balance_usd: 4_820_000,
        avg_crypto_balance_usd: 12_350_000,
        coverage_ratio: 1.82,
        net_ramp_usd: 1_450_000,
        total_fees_usd: 2_700,
        ramp_count: 42,
      },
    },
    {
      view: { slug: 'balance_trend', label: 'Balance Trend', chartType: 'line' },
      query: { from: '2026-03-01', to: '2026-03-31' },
      series: {
        bank_balance_usd: Array.from({ length: 14 }, (_, i) => ({
          date: `2026-03-${String(i * 2 + 1).padStart(2, '0')}`,
          value: 4_500_000 + Math.sin(i / 2) * 500_000,
        })),
        crypto_balance_usd: Array.from({ length: 14 }, (_, i) => ({
          date: `2026-03-${String(i * 2 + 1).padStart(2, '0')}`,
          value: 12_000_000 + Math.cos(i / 2) * 750_000,
        })),
      },
    },
    {
      view: { slug: 'fees_by_venue', label: 'Fees by Venue', chartType: 'bar' },
      query: { from: '2026-03-01', to: '2026-03-31' },
      groups: {
        fees_usd: [
          { group: 'Coinbase Prime', value: 12_400 },
          { group: 'Circle Mint', value: 8_900 },
          { group: 'Kraken Institutional', value: 6_200 },
          { group: 'Morpho Blue', value: 3_100 },
          { group: 'Aave v3', value: 1_850 },
        ],
      },
    },
    {
      view: { slug: 'top_counterparties', label: 'Top Counterparties', chartType: 'table' },
      query: { from: '2026-03-01', to: '2026-03-31' },
      rows: [
        { counterparty: 'Acme Logistics GmbH', transfers: 14, volume_usd: 1_230_000 },
        { counterparty: 'Harborline Shipping', transfers: 9, volume_usd: 870_000 },
        { counterparty: 'Meridian Payroll Services', transfers: 31, volume_usd: 612_000 },
        { counterparty: 'Beacon Marketing Co.', transfers: 6, volume_usd: 118_000 },
        { counterparty: 'Crestwood Facilities', transfers: 4, volume_usd: 74_500 },
      ],
    },
  ];
  await write(
    '04-analytics-report.pdf',
    <AnalyticsReportPdf period={{ from: '2026-03-01', to: '2026-03-31' }} sections={analytics} />,
  );

  console.log('\nDone.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
