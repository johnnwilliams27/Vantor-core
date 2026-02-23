import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { ReportData } from './report';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    padding: 32,
    color: '#1a1a2e',
  },
  header: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 10,
    color: '#64748b',
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
    marginTop: 16,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 3,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  summaryCard: {
    width: '30%',
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    padding: 8,
  },
  summaryLabel: {
    fontSize: 8,
    color: '#64748b',
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
  },
  table: {
    marginTop: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    padding: 4,
    borderRadius: 2,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: 'row',
    padding: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableRowAlt: {
    flexDirection: 'row',
    padding: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#fafafa',
  },
  th: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: '#475569',
  },
  td: {
    fontSize: 8,
    color: '#334155',
  },
  col1: { width: '20%' },
  col2: { width: '20%' },
  col3: { width: '20%' },
  col4: { width: '20%' },
  col5: { width: '20%' },
  col6w: { width: '35%' },
  col2m: { width: '15%' },
  col3m: { width: '15%' },
  col4m: { width: '15%' },
  col5m: { width: '20%' },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 32,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    color: '#94a3b8',
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
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Vantor Treasury Report</Text>
          <Text style={styles.subtitle}>
            Period: {period.from} — {period.to} · Generated {generatedAt}
          </Text>
        </View>

        {/* Summary Grid */}
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Avg Bank Balance</Text>
            <Text style={styles.summaryValue}>{fmt(summary.avgBankBalanceUsd)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Avg Crypto Balance</Text>
            <Text style={styles.summaryValue}>{fmt(summary.avgCryptoBalanceUsd)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Net Ramp</Text>
            <Text style={styles.summaryValue}>{fmt(summary.netRampUsd)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total On-Ramp</Text>
            <Text style={styles.summaryValue}>{fmt(summary.totalOnrampUsd)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Off-Ramp</Text>
            <Text style={styles.summaryValue}>{fmt(summary.totalOfframpUsd)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Avg Coverage Ratio</Text>
            <Text style={styles.summaryValue}>{summary.avgObligationCoverageRatio.toFixed(2)}×</Text>
          </View>
        </View>

        {/* Balance History Table */}
        <Text style={styles.sectionTitle}>Balance History</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.col1]}>Date</Text>
            <Text style={[styles.th, styles.col2]}>Bank (USD)</Text>
            <Text style={[styles.th, styles.col3]}>Crypto (USD)</Text>
          </View>
          {balanceHistory.slice(0, 60).map((row, i) => (
            <View key={row.date} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <Text style={[styles.td, styles.col1]}>{row.date}</Text>
              <Text style={[styles.td, styles.col2]}>{fmt(row.bankUsd)}</Text>
              <Text style={[styles.td, styles.col3]}>{fmt(row.cryptoUsd)}</Text>
            </View>
          ))}
          {balanceHistory.length > 60 && (
            <View style={styles.tableRow}>
              <Text style={[styles.td, { color: '#94a3b8' }]}>
                ... and {balanceHistory.length - 60} more rows (see CSV export for full data)
              </Text>
            </View>
          )}
        </View>

        {/* Recommendation Outcomes */}
        <Text style={styles.sectionTitle}>AI Recommendation Outcomes</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.col2m]}>Date</Text>
            <Text style={[styles.th, styles.col2m]}>Action</Text>
            <Text style={[styles.th, styles.col3m]}>Amount</Text>
            <Text style={[styles.th, styles.col4m]}>Status</Text>
            <Text style={[styles.th, styles.col6w]}>Reasoning</Text>
          </View>
          {recommendationOutcomes.slice(0, 30).map((rec, i) => (
            <View key={rec.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <Text style={[styles.td, styles.col2m]}>{rec.created_at.split('T')[0]}</Text>
              <Text style={[styles.td, styles.col2m]}>{rec.action}</Text>
              <Text style={[styles.td, styles.col3m]}>
                {rec.recommended_amount_usd ? fmt(parseFloat(rec.recommended_amount_usd)) : '—'}
              </Text>
              <Text style={[styles.td, styles.col4m]}>{rec.status}</Text>
              <Text style={[styles.td, styles.col6w]}>{rec.ai_reasoning.slice(0, 80)}</Text>
            </View>
          ))}
        </View>

        {/* Ramp Summary */}
        <Text style={styles.sectionTitle}>Ramp History</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.col1]}>Date</Text>
            <Text style={[styles.th, styles.col2m]}>Direction</Text>
            <Text style={[styles.th, styles.col3m]}>Fiat Amount</Text>
            <Text style={[styles.th, styles.col4m]}>Currency</Text>
            <Text style={[styles.th, styles.col5m]}>Status</Text>
          </View>
          {rampSummary.slice(0, 30).map((ramp, i) => (
            <View key={ramp.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <Text style={[styles.td, styles.col1]}>{ramp.created_at.split('T')[0]}</Text>
              <Text style={[styles.td, styles.col2m]}>{ramp.direction}</Text>
              <Text style={[styles.td, styles.col3m]}>{fmt(parseFloat(ramp.fiat_amount))}</Text>
              <Text style={[styles.td, styles.col4m]}>{ramp.fiat_currency}</Text>
              <Text style={[styles.td, styles.col5m]}>{ramp.status}</Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Vantor Treasury Platform</Text>
          <Text style={styles.footerText}>
            {period.from} — {period.to}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
