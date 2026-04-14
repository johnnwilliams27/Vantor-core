import React from 'react';
import { Document, Image, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { PDF_COLORS, PDF_LOGO_SRC, PDF_TYPE, PDF_STYLES } from '../export/pdf-tokens';
import { getMeasureLabel } from './measures';
import type { ViewResult } from './types';

/**
 * AnalyticsReportPdf
 *
 * Multi-section analytics report. Mirrors the Analytics page structure
 * (KPI banner + each pinned view) using the shared Vantor PDF tokens so
 * the output reads as part of the same system as invoices, transfers,
 * and treasury reports.
 */

const fmtUsd = (n: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

const fmtNumber = (n: number): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

function formatKpiValue(slug: string, value: number): string {
  if (slug === 'coverage_ratio') return `${value.toFixed(2)}×`;
  if (slug.endsWith('_count')) return fmtNumber(value);
  return fmtUsd(value);
}

const styles = StyleSheet.create({
  numeric: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 500,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.text100,
    textAlign: 'right',
  },
});

function SectionContent({ result }: { result: ViewResult }): React.ReactElement {
  const { chartType } = result.view;

  if (chartType === 'kpi' && result.scalar && Object.keys(result.scalar).length > 0) {
    const scalar = result.scalar;
    return (
      <View style={PDF_STYLES.kpiGrid}>
        {Object.keys(scalar).map((slug) => (
          <View key={slug} style={PDF_STYLES.kpiCard}>
            <Text style={PDF_STYLES.kpiLabel}>{getMeasureLabel(slug)}</Text>
            <Text style={PDF_STYLES.kpiValue}>{formatKpiValue(slug, scalar[slug])}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (chartType === 'line' && result.series && Object.keys(result.series).length > 0) {
    const series = result.series;
    const seriesKeys = Object.keys(series);
    const firstKey = seriesKeys[0];
    const dates = series[firstKey].map((p) => p.date);

    if (dates.length === 0) {
      return <Text style={PDF_STYLES.emptyNote}>No data for this period.</Text>;
    }

    const colWidth = `${Math.floor(100 / (seriesKeys.length + 1))}%`;

    return (
      <View>
        <View style={PDF_STYLES.tableHeader}>
          <Text style={[PDF_STYLES.th, { width: colWidth }]}>Date</Text>
          {seriesKeys.map((k) => (
            <Text key={k} style={[PDF_STYLES.th, { width: colWidth, textAlign: 'right' }]}>
              {getMeasureLabel(k)}
            </Text>
          ))}
        </View>
        {dates.slice(0, 40).map((date, i) => (
          <View key={date} style={[PDF_STYLES.tableRow, i % 2 === 1 ? PDF_STYLES.tableRowAlt : {}]}>
            <Text style={[PDF_STYLES.td, { width: colWidth }]}>{date}</Text>
            {seriesKeys.map((k) => (
              <Text key={k} style={[styles.numeric, { width: colWidth }]}>
                {fmtUsd(series[k][i]?.value ?? 0)}
              </Text>
            ))}
          </View>
        ))}
        {dates.length > 40 && (
          <Text style={PDF_STYLES.emptyNote}>
            Showing 40 of {dates.length} rows. Export CSV for the full series.
          </Text>
        )}
      </View>
    );
  }

  if (chartType === 'bar' && result.groups && Object.keys(result.groups).length > 0) {
    const groups = result.groups;
    const groupKeys = Object.keys(groups);
    const firstKey = groupKeys[0];
    const groupNames = groups[firstKey].map((p) => p.group);

    if (groupNames.length === 0) {
      return <Text style={PDF_STYLES.emptyNote}>No data for this period.</Text>;
    }

    const colWidth = `${Math.floor(100 / (groupKeys.length + 1))}%`;

    return (
      <View>
        <View style={PDF_STYLES.tableHeader}>
          <Text style={[PDF_STYLES.th, { width: colWidth }]}>Group</Text>
          {groupKeys.map((k) => (
            <Text key={k} style={[PDF_STYLES.th, { width: colWidth, textAlign: 'right' }]}>
              {getMeasureLabel(k)}
            </Text>
          ))}
        </View>
        {groupNames.map((group, i) => (
          <View key={group} style={[PDF_STYLES.tableRow, i % 2 === 1 ? PDF_STYLES.tableRowAlt : {}]}>
            <Text style={[PDF_STYLES.td, { width: colWidth }]}>{group}</Text>
            {groupKeys.map((k) => (
              <Text key={k} style={[styles.numeric, { width: colWidth }]}>
                {fmtUsd(groups[k][i]?.value ?? 0)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    );
  }

  if (chartType === 'table' && result.rows && result.rows.length > 0) {
    const rows = result.rows;
    const columns = Object.keys(rows[0]);
    const colWidth = `${Math.floor(100 / columns.length)}%`;

    return (
      <View>
        <View style={PDF_STYLES.tableHeader}>
          {columns.map((c) => (
            <Text key={c} style={[PDF_STYLES.th, { width: colWidth }]}>
              {getMeasureLabel(c)}
            </Text>
          ))}
        </View>
        {rows.slice(0, 30).map((row, i) => (
          <View key={i} style={[PDF_STYLES.tableRow, i % 2 === 1 ? PDF_STYLES.tableRowAlt : {}]}>
            {columns.map((c) => {
              const v = row[c];
              const display =
                v === null || v === undefined
                  ? '—'
                  : typeof v === 'number'
                    ? fmtNumber(v)
                    : String(v).slice(0, 60);
              const isNum = typeof v === 'number';
              return (
                <Text key={c} style={[isNum ? styles.numeric : PDF_STYLES.td, { width: colWidth }]}>
                  {display}
                </Text>
              );
            })}
          </View>
        ))}
        {rows.length > 30 && (
          <Text style={PDF_STYLES.emptyNote}>
            Showing 30 of {rows.length} rows. Export CSV for the full table.
          </Text>
        )}
      </View>
    );
  }

  return <Text style={PDF_STYLES.emptyNote}>No data for this period.</Text>;
}

export interface AnalyticsReportPdfProps {
  period: { from: string; to: string };
  sections: ViewResult[];
}

export function AnalyticsReportPdf({
  period,
  sections,
}: AnalyticsReportPdfProps): React.ReactElement {
  const generatedAt = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Document
      title={`Vantor Analytics Report ${period.from} to ${period.to}`}
      author="Vantor"
    >
      <Page size="A4" style={PDF_STYLES.page}>
        <View style={PDF_STYLES.header}>
          <View style={PDF_STYLES.headerRow}>
            <View>
              <Image src={PDF_LOGO_SRC} style={PDF_STYLES.logo} />
              <Text style={PDF_STYLES.title}>Analytics Report</Text>
            </View>
            <Text style={PDF_STYLES.subtitle}>
              {period.from} — {period.to} · Generated {generatedAt}
            </Text>
          </View>
        </View>

        {sections.length === 0 && (
          <Text style={PDF_STYLES.emptyNote}>No views pinned for this report.</Text>
        )}

        {sections.map((result) => (
          <View key={result.view.slug} wrap={false} style={{ marginBottom: 8 }}>
            <Text style={PDF_STYLES.sectionTitle}>{result.view.label}</Text>
            <SectionContent result={result} />
          </View>
        ))}

        <View style={PDF_STYLES.footer} fixed>
          <Image src={PDF_LOGO_SRC} style={PDF_STYLES.logoFooter} />
          <Text
            style={PDF_STYLES.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
