import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { PDF_COLORS, PDF_LOGO_SRC, PDF_STYLES } from './pdf-tokens';
import type { ExportColumn } from './index';

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
    <Document title={title} author="Vantor">
      <Page size="A4" orientation={orientation} style={PDF_STYLES.page}>
        <View style={PDF_STYLES.header}>
          <View style={PDF_STYLES.headerRow}>
            <View>
              <Image src={PDF_LOGO_SRC} style={PDF_STYLES.logo} />
              <Text style={PDF_STYLES.title}>{title}</Text>
            </View>
            <Text style={PDF_STYLES.subtitle}>
              {rows.length} record{rows.length !== 1 ? 's' : ''} · Generated {generatedAt}
            </Text>
          </View>
        </View>

        <View style={PDF_STYLES.tableHeader}>
          {columns.map((col, i) => (
            <Text key={i} style={[PDF_STYLES.th, { width: col.width }]}>
              {col.header}
            </Text>
          ))}
        </View>

        {displayRows.map((row, ri) => (
          <View
            key={ri}
            style={[PDF_STYLES.tableRow, ri % 2 === 1 ? PDF_STYLES.tableRowAlt : {}]}
          >
            {row.map((cell, ci) => (
              <Text
                key={ci}
                style={[PDF_STYLES.td, { width: columns[ci].width }]}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}

        {truncated && (
          <Text style={PDF_STYLES.emptyNote}>
            …and {rows.length - 500} more rows (not shown in PDF — export CSV for the full dataset)
          </Text>
        )}

        <View style={PDF_STYLES.footer} fixed>
          <Image src={PDF_LOGO_SRC} style={PDF_STYLES.logoFooter} />
          <Text
            style={PDF_STYLES.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
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

export { TableExportPdf };
export { PDF_COLORS };
