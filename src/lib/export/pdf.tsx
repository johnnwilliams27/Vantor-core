import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { ExportColumn } from './index';

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
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 9,
    color: '#64748b',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tableRowAlt: {
    backgroundColor: '#fafbfc',
  },
  tableCell: {
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
    fontSize: 7,
    color: '#94a3b8',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 4,
  },
});

interface TableExportPdfProps {
  title: string;
  columns: { header: string; width: string }[];
  rows: string[][];
  generatedAt: string;
  orientation?: 'portrait' | 'landscape';
}

function TableExportPdf({ title, columns, rows, generatedAt, orientation = 'portrait' }: TableExportPdfProps) {
  const displayRows = rows.slice(0, 500);
  const truncated = rows.length > 500;

  return (
    <Document>
      <Page size="A4" orientation={orientation} style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            Vantor Treasury · Generated {generatedAt} · {rows.length} record{rows.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Table header */}
        <View style={styles.tableHeader}>
          {columns.map((col, i) => (
            <Text key={i} style={[styles.tableHeaderCell, { width: col.width }]}>
              {col.header}
            </Text>
          ))}
        </View>

        {/* Table rows */}
        {displayRows.map((row, ri) => (
          <View
            key={ri}
            style={[styles.tableRow, ri % 2 === 1 ? styles.tableRowAlt : {}]}
          >
            {row.map((cell, ci) => (
              <Text
                key={ci}
                style={[styles.tableCell, { width: columns[ci].width }]}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}

        {truncated && (
          <Text style={{ fontSize: 8, color: '#94a3b8', marginTop: 8 }}>
            …and {rows.length - 500} more rows (not shown in PDF)
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text>Vantor</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function exportPdf<T>(
  filename: string,
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  orientation?: 'portrait' | 'landscape',
) {
  const { pdf } = await import('@react-pdf/renderer');

  const defaultWidth = `${Math.floor(100 / columns.length)}%`;
  const pdfColumns = columns.map((c) => ({
    header: c.header,
    width: c.pdfWidth ?? defaultWidth,
  }));
  const pdfRows = rows.map((row) => columns.map((c) => c.accessor(row)));

  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const blob = await (pdf as any)(
    <TableExportPdf
      title={title}
      columns={pdfColumns}
      rows={pdfRows}
      generatedAt={now}
      orientation={orientation}
    />
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
