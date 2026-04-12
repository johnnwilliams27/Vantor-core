import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { getMeasureLabel } from './measures';
import type { ViewResult } from './types';

/**
 * AnalyticsReportPdf
 *
 * Renders a multi-section PDF combining the Treasury Summary KPI banner and
 * every pinned view the user has configured. Mirrors the visual structure of
 * the UI (section titles + content) so the printout reads like a snapshot of
 * the live Analytics page rather than a dump of raw numbers.
 *
 * The component is invoked from the `/api/analytics/export/report` route
 * with a dynamic import, identical to how `TreasuryReportPdf` is used by
 * `/api/treasury/report`. Keeps @react-pdf out of the edge runtime.
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
  sectionDescription: {
    fontSize: 8,
    color: '#94a3b8',
    marginTop: -4,
    marginBottom: 6,
  },
  emptyNote: {
    fontSize: 9,
    color: '#94a3b8',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  kpiCard: {
    width: '30%',
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    padding: 8,
  },
  kpiLabel: {
    fontSize: 8,
    color: '#64748b',
    marginBottom: 2,
  },
  kpiValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
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

/**
 * Render any ViewResult as a block of PDF content. Dispatches on chartType
 * and falls back to a "no data" note when the resolver returned nothing.
 */
function SectionContent({ result }: { result: ViewResult }): React.ReactElement {
  const { chartType } = result.view;

  // KPI — scalar grid
  if (chartType === 'kpi' && result.scalar && Object.keys(result.scalar).length > 0) {
    const scalar = result.scalar;
    return (
      <View style={styles.kpiGrid}>
        {Object.keys(scalar).map((slug) => (
          <View key={slug} style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{getMeasureLabel(slug)}</Text>
            <Text style={styles.kpiValue}>{formatKpiValue(slug, scalar[slug])}</Text>
          </View>
        ))}
      </View>
    );
  }

  // Line — Date + one column per series
  if (chartType === 'line' && result.series && Object.keys(result.series).length > 0) {
    const series = result.series;
    const seriesKeys = Object.keys(series);
    const firstKey = seriesKeys[0];
    const dates = series[firstKey].map((p) => p.date);

    if (dates.length === 0) {
      return <Text style={styles.emptyNote}>No data for this period.</Text>;
    }

    const colWidth = `${Math.floor(100 / (seriesKeys.length + 1))}%`;

    return (
      <View>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { width: colWidth }]}>Date</Text>
          {seriesKeys.map((k) => (
            <Text key={k} style={[styles.th, { width: colWidth }]}>
              {getMeasureLabel(k)}
            </Text>
          ))}
        </View>
        {dates.slice(0, 40).map((date, i) => (
          <View key={date} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
            <Text style={[styles.td, { width: colWidth }]}>{date}</Text>
            {seriesKeys.map((k) => (
              <Text key={k} style={[styles.td, { width: colWidth }]}>
                {fmtUsd(series[k][i]?.value ?? 0)}
              </Text>
            ))}
          </View>
        ))}
        {dates.length > 40 && (
          <Text style={styles.emptyNote}>
            Showing 40 of {dates.length} rows. Export CSV for the full series.
          </Text>
        )}
      </View>
    );
  }

  // Bar — Group + one column per grouped measure
  if (chartType === 'bar' && result.groups && Object.keys(result.groups).length > 0) {
    const groups = result.groups;
    const groupKeys = Object.keys(groups);
    const firstKey = groupKeys[0];
    const groupNames = groups[firstKey].map((p) => p.group);

    if (groupNames.length === 0) {
      return <Text style={styles.emptyNote}>No data for this period.</Text>;
    }

    const colWidth = `${Math.floor(100 / (groupKeys.length + 1))}%`;

    return (
      <View>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { width: colWidth }]}>Group</Text>
          {groupKeys.map((k) => (
            <Text key={k} style={[styles.th, { width: colWidth }]}>
              {getMeasureLabel(k)}
            </Text>
          ))}
        </View>
        {groupNames.map((group, i) => (
          <View key={group} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
            <Text style={[styles.td, { width: colWidth }]}>{group}</Text>
            {groupKeys.map((k) => (
              <Text key={k} style={[styles.td, { width: colWidth }]}>
                {fmtUsd(groups[k][i]?.value ?? 0)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    );
  }

  // Table — raw rows
  if (chartType === 'table' && result.rows && result.rows.length > 0) {
    const rows = result.rows;
    const columns = Object.keys(rows[0]);
    const colWidth = `${Math.floor(100 / columns.length)}%`;

    return (
      <View>
        <View style={styles.tableHeader}>
          {columns.map((c) => (
            <Text key={c} style={[styles.th, { width: colWidth }]}>
              {getMeasureLabel(c)}
            </Text>
          ))}
        </View>
        {rows.slice(0, 30).map((row, i) => (
          <View key={i} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
            {columns.map((c) => {
              const v = row[c];
              const display =
                v === null || v === undefined
                  ? '—'
                  : typeof v === 'number'
                    ? fmtNumber(v)
                    : String(v).slice(0, 60);
              return (
                <Text key={c} style={[styles.td, { width: colWidth }]}>
                  {display}
                </Text>
              );
            })}
          </View>
        ))}
        {rows.length > 30 && (
          <Text style={styles.emptyNote}>
            Showing 30 of {rows.length} rows. Export CSV for the full table.
          </Text>
        )}
      </View>
    );
  }

  return <Text style={styles.emptyNote}>No data for this period.</Text>;
}

export interface AnalyticsReportPdfProps {
  period: { from: string; to: string };
  /** Resolved ViewResults in the order they should appear in the PDF. */
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
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Vantor Analytics Report</Text>
          <Text style={styles.subtitle}>
            Period: {period.from} — {period.to} · Generated {generatedAt}
          </Text>
        </View>

        {sections.length === 0 && (
          <Text style={styles.emptyNote}>No views pinned for this report.</Text>
        )}

        {sections.map((result) => (
          <View key={result.view.slug} wrap={false} style={{ marginBottom: 4 }}>
            <Text style={styles.sectionTitle}>{result.view.label}</Text>
            <SectionContent result={result} />
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Vantor · vantor.xyz</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
