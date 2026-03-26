import { renderToBuffer } from '@react-pdf/renderer';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import React from 'react';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#19595b' },
  subtitle: { fontSize: 10, color: '#666', marginTop: 4 },
  billTo: { marginBottom: 20 },
  billToLabel: { fontSize: 8, color: '#999', marginBottom: 2 },
  billToName: { fontSize: 12, fontWeight: 'bold' },
  table: { marginTop: 10 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd', paddingBottom: 6, marginBottom: 6 },
  tableRow: { flexDirection: 'row', paddingVertical: 4 },
  colDesc: { flex: 3 },
  colAmount: { flex: 1, textAlign: 'right' },
  totalRow: { flexDirection: 'row', borderTopWidth: 2, borderColor: '#19595b', paddingTop: 8, marginTop: 8 },
  totalLabel: { flex: 3, fontWeight: 'bold', fontSize: 12 },
  totalAmount: { flex: 1, textAlign: 'right', fontWeight: 'bold', fontSize: 12, color: '#19595b' },
  footer: { position: 'absolute', bottom: 40, left: 40, right: 40, textAlign: 'center', fontSize: 8, color: '#999' },
});

export interface InvoiceData {
  enterpriseName: string;
  billingPeriod: string;
  tierName: string;
  subscriptionCost: number;
  erpAddons: number;
  erpAddonCost: number;
  rampCount: number;
  rampFees: number;
  swapCount: number;
  swapFees: number;
  bridgeCount: number;
  bridgeFees: number;
  cardLast4?: string;
}

function InvoicePdf({ data }: { data: InvoiceData }) {
  const total = data.subscriptionCost + data.erpAddonCost + data.rampFees + data.swapFees + data.bridgeFees;
  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>VANTOR</Text>
            <Text style={styles.subtitle}>Treasury Management Platform</Text>
          </View>
          <View>
            <Text style={{ fontSize: 16, fontWeight: 'bold' }}>Invoice</Text>
            <Text style={styles.subtitle}>{data.billingPeriod}</Text>
          </View>
        </View>

        <View style={styles.billTo}>
          <Text style={styles.billToLabel}>BILL TO</Text>
          <Text style={styles.billToName}>{data.enterpriseName}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colDesc, { fontWeight: 'bold', color: '#666' }]}>Description</Text>
            <Text style={[styles.colAmount, { fontWeight: 'bold', color: '#666' }]}>Amount</Text>
          </View>

          <View style={styles.tableRow}>
            <Text style={styles.colDesc}>Subscription: {data.tierName}</Text>
            <Text style={styles.colAmount}>{fmt(data.subscriptionCost)}</Text>
          </View>

          {data.erpAddons > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDesc}>ERP Add-ons ({data.erpAddons} additional)</Text>
              <Text style={styles.colAmount}>{fmt(data.erpAddonCost)}</Text>
            </View>
          )}

          {data.rampCount > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDesc}>Ramp fees ({data.rampCount} transactions)</Text>
              <Text style={styles.colAmount}>{fmt(data.rampFees)}</Text>
            </View>
          )}

          {data.swapCount > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDesc}>Swap fees ({data.swapCount} transactions)</Text>
              <Text style={styles.colAmount}>{fmt(data.swapFees)}</Text>
            </View>
          )}

          {data.bridgeCount > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDesc}>Bridge fees ({data.bridgeCount} transactions)</Text>
              <Text style={styles.colAmount}>{fmt(data.bridgeFees)}</Text>
            </View>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{fmt(total)}</Text>
          </View>
        </View>

        {data.cardLast4 && (
          <View style={{ marginTop: 20 }}>
            <Text style={{ color: '#666', fontSize: 9 }}>
              Charged to card ending in {data.cardLast4}
            </Text>
          </View>
        )}

        <Text style={styles.footer}>
          For detailed transaction records, log in to app.vantor.xyz
        </Text>
      </Page>
    </Document>
  );
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf data={data} />);
}
