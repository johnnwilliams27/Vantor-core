import React from 'react';
import { Document, Image, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { PDF_COLORS, PDF_LOGO_SRC, PDF_TYPE, PDF_STYLES } from '../export/pdf-tokens';
import type { ReportData } from './report';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

const styles = StyleSheet.create({
  col1: { width: '20%' },
  col2: { width: '20%' },
  col3: { width: '20%' },
  col6w: { width: '35%' },
  col2m: { width: '15%' },
  col3m: { width: '15%' },
  col4m: { width: '15%' },
  col5m: { width: '20%' },
  numeric: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 500,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.text100,
  },
  statusPill: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 500,
    fontSize: PDF_TYPE.micro,
    color: PDF_COLORS.text200,
    textTransform: 'capitalize',
  },
});

interface Props {
  data: ReportData;
}

export function TreasuryReportPdf({ data }: Props): React.ReactElement {
  const { period, summary, balanceHistory, recommendationOutcomes, rampSummary } = data;
  const generatedAt = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Document title={`Vantor Treasury Report ${period.from} to ${period.to}`} author="Vantor">
      <Page size="A4" style={PDF_STYLES.page}>
        <View style={PDF_STYLES.header}>
          <View style={PDF_STYLES.headerRow}>
            <View>
              <Image src={PDF_LOGO_SRC} style={PDF_STYLES.logo} />
              <Text style={PDF_STYLES.title}>Treasury Report</Text>
            </View>
            <Text style={PDF_STYLES.subtitle}>
              {period.from} — {period.to} · Generated {generatedAt}
            </Text>
          </View>
        </View>

        <Text style={PDF_STYLES.sectionTitle}>Summary</Text>
        <View style={PDF_STYLES.kpiGrid}>
          <View style={PDF_STYLES.kpiCard}>
            <Text style={PDF_STYLES.kpiLabel}>Avg bank balance</Text>
            <Text style={PDF_STYLES.kpiValue}>{fmt(summary.avgBankBalanceUsd)}</Text>
          </View>
          <View style={PDF_STYLES.kpiCard}>
            <Text style={PDF_STYLES.kpiLabel}>Avg stablecoin balance</Text>
            <Text style={PDF_STYLES.kpiValue}>{fmt(summary.avgCryptoBalanceUsd)}</Text>
          </View>
          <View style={PDF_STYLES.kpiCard}>
            <Text style={PDF_STYLES.kpiLabel}>Net ramp</Text>
            <Text style={PDF_STYLES.kpiValue}>{fmt(summary.netRampUsd)}</Text>
          </View>
          <View style={PDF_STYLES.kpiCard}>
            <Text style={PDF_STYLES.kpiLabel}>Total on-ramp</Text>
            <Text style={PDF_STYLES.kpiValue}>{fmt(summary.totalOnrampUsd)}</Text>
          </View>
          <View style={PDF_STYLES.kpiCard}>
            <Text style={PDF_STYLES.kpiLabel}>Total off-ramp</Text>
            <Text style={PDF_STYLES.kpiValue}>{fmt(summary.totalOfframpUsd)}</Text>
          </View>
          <View style={PDF_STYLES.kpiCard}>
            <Text style={PDF_STYLES.kpiLabel}>Avg coverage ratio</Text>
            <Text style={PDF_STYLES.kpiValue}>{summary.avgObligationCoverageRatio.toFixed(2)}×</Text>
          </View>
        </View>

        <Text style={PDF_STYLES.sectionTitle}>Balance history</Text>
        <View style={PDF_STYLES.table}>
          <View style={PDF_STYLES.tableHeader}>
            <Text style={[PDF_STYLES.th, styles.col1]}>Date</Text>
            <Text style={[PDF_STYLES.th, styles.col2, { textAlign: 'right' }]}>Bank (USD)</Text>
            <Text style={[PDF_STYLES.th, styles.col3, { textAlign: 'right' }]}>Stablecoins (USD)</Text>
          </View>
          {balanceHistory.slice(0, 60).map((row, i) => (
            <View key={row.date} style={[PDF_STYLES.tableRow, i % 2 === 1 ? PDF_STYLES.tableRowAlt : {}]}>
              <Text style={[PDF_STYLES.td, styles.col1]}>{row.date}</Text>
              <Text style={[styles.numeric, styles.col2, { textAlign: 'right' }]}>{fmt(row.bankUsd)}</Text>
              <Text style={[styles.numeric, styles.col3, { textAlign: 'right' }]}>{fmt(row.cryptoUsd)}</Text>
            </View>
          ))}
          {balanceHistory.length > 60 && (
            <Text style={PDF_STYLES.emptyNote}>
              …and {balanceHistory.length - 60} more rows — see CSV export for the full series.
            </Text>
          )}
        </View>

        <Text style={PDF_STYLES.sectionTitle}>AI recommendation outcomes</Text>
        <View style={PDF_STYLES.table}>
          <View style={PDF_STYLES.tableHeader}>
            <Text style={[PDF_STYLES.th, styles.col2m]}>Date</Text>
            <Text style={[PDF_STYLES.th, styles.col2m]}>Action</Text>
            <Text style={[PDF_STYLES.th, styles.col3m, { textAlign: 'right' }]}>Amount</Text>
            <Text style={[PDF_STYLES.th, styles.col4m]}>Status</Text>
            <Text style={[PDF_STYLES.th, styles.col6w]}>Reasoning</Text>
          </View>
          {recommendationOutcomes.slice(0, 30).map((rec, i) => (
            <View key={rec.id} style={[PDF_STYLES.tableRow, i % 2 === 1 ? PDF_STYLES.tableRowAlt : {}]}>
              <Text style={[PDF_STYLES.td, styles.col2m]}>{rec.created_at.split('T')[0]}</Text>
              <Text style={[PDF_STYLES.td, styles.col2m]}>{rec.action}</Text>
              <Text style={[styles.numeric, styles.col3m, { textAlign: 'right' }]}>
                {rec.recommended_amount_usd ? fmt(parseFloat(rec.recommended_amount_usd)) : '—'}
              </Text>
              <Text style={[styles.statusPill, styles.col4m]}>{rec.status}</Text>
              <Text style={[PDF_STYLES.td, styles.col6w]}>{rec.ai_reasoning.slice(0, 80)}</Text>
            </View>
          ))}
        </View>

        <Text style={PDF_STYLES.sectionTitle}>Ramp history</Text>
        <View style={PDF_STYLES.table}>
          <View style={PDF_STYLES.tableHeader}>
            <Text style={[PDF_STYLES.th, styles.col1]}>Date</Text>
            <Text style={[PDF_STYLES.th, styles.col2m]}>Direction</Text>
            <Text style={[PDF_STYLES.th, styles.col3m, { textAlign: 'right' }]}>Bank amount</Text>
            <Text style={[PDF_STYLES.th, styles.col4m]}>Currency</Text>
            <Text style={[PDF_STYLES.th, styles.col5m]}>Status</Text>
          </View>
          {rampSummary.slice(0, 30).map((ramp, i) => (
            <View key={ramp.id} style={[PDF_STYLES.tableRow, i % 2 === 1 ? PDF_STYLES.tableRowAlt : {}]}>
              <Text style={[PDF_STYLES.td, styles.col1]}>{ramp.created_at.split('T')[0]}</Text>
              <Text style={[PDF_STYLES.td, styles.col2m]}>{ramp.direction}</Text>
              <Text style={[styles.numeric, styles.col3m, { textAlign: 'right' }]}>{fmt(parseFloat(ramp.fiat_amount))}</Text>
              <Text style={[PDF_STYLES.td, styles.col4m]}>{ramp.fiat_currency}</Text>
              <Text style={[styles.statusPill, styles.col5m]}>{ramp.status}</Text>
            </View>
          ))}
        </View>

        <View style={PDF_STYLES.footer} fixed>
          <Image src={PDF_LOGO_SRC} style={PDF_STYLES.logoFooter} />
          <Text style={PDF_STYLES.footerText}>
            {period.from} — {period.to} · vantor.xyz
          </Text>
        </View>
      </Page>
    </Document>
  );
}
