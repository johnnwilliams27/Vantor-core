import { renderToBuffer } from '@react-pdf/renderer';
import { Document, Image, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import React from 'react';
import { PDF_COLORS, PDF_LOGO_SRC, PDF_TYPE, PDF_STYLES } from '../export/pdf-tokens';

const styles = StyleSheet.create({
  billTo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  billToLabel: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: PDF_TYPE.micro,
    color: PDF_COLORS.text400,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  billToName: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: 13,
    color: PDF_COLORS.text100,
  },
  colDesc: { flex: 3 },
  colAmount: { flex: 1, textAlign: 'right' },
  lineLabel: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 400,
    fontSize: PDF_TYPE.body,
    color: PDF_COLORS.text200,
  },
  lineAmount: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 500,
    fontSize: PDF_TYPE.body,
    color: PDF_COLORS.text100,
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    borderTopWidth: 2,
    borderTopColor: PDF_COLORS.primaryL1,
    paddingTop: 12,
    marginTop: 10,
  },
  totalLabel: {
    flex: 3,
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: 13,
    color: PDF_COLORS.text100,
  },
  totalAmount: {
    flex: 1,
    textAlign: 'right',
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: 13,
    color: PDF_COLORS.primaryL1,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.borderSoft,
  },
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
  transferCount: number;
  transferFees: number;
  paymentCount: number;
  paymentFees: number;
  cardLast4?: string;
}

function InvoicePdf({ data }: { data: InvoiceData }) {
  const total =
    data.subscriptionCost +
    data.erpAddonCost +
    data.rampFees +
    data.swapFees +
    data.bridgeFees +
    data.transferFees +
    data.paymentFees;
  const fmt = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Document title={`Vantor Invoice — ${data.billingPeriod}`} author="Vantor">
      <Page size="A4" style={PDF_STYLES.page}>
        <View style={PDF_STYLES.header}>
          <View style={PDF_STYLES.headerRow}>
            <View>
              <Image src={PDF_LOGO_SRC} style={PDF_STYLES.logo} />
              <Text style={PDF_STYLES.title}>Invoice</Text>
              <Text style={PDF_STYLES.subtitle}>Stablecoin treasury platform</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.billToLabel}>Billing period</Text>
              <Text style={styles.billToName}>{data.billingPeriod}</Text>
            </View>
          </View>
        </View>

        <View style={styles.billTo}>
          <View>
            <Text style={styles.billToLabel}>Bill to</Text>
            <Text style={styles.billToName}>{data.enterpriseName}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.billToLabel}>Plan</Text>
            <Text style={styles.billToName}>{data.tierName}</Text>
          </View>
        </View>

        <View style={PDF_STYLES.tableHeader}>
          <Text style={[PDF_STYLES.th, styles.colDesc]}>Description</Text>
          <Text style={[PDF_STYLES.th, styles.colAmount]}>Amount</Text>
        </View>

        <View style={styles.tableRow}>
          <Text style={[styles.lineLabel, styles.colDesc]}>
            Subscription · {data.tierName}
          </Text>
          <Text style={[styles.lineAmount, styles.colAmount]}>{fmt(data.subscriptionCost)}</Text>
        </View>

        {data.erpAddons > 0 && (
          <View style={styles.tableRow}>
            <Text style={[styles.lineLabel, styles.colDesc]}>
              ERP add-ons · {data.erpAddons} additional
            </Text>
            <Text style={[styles.lineAmount, styles.colAmount]}>{fmt(data.erpAddonCost)}</Text>
          </View>
        )}

        {data.rampCount > 0 && (
          <View style={styles.tableRow}>
            <Text style={[styles.lineLabel, styles.colDesc]}>
              Ramp fees · {data.rampCount} transactions
            </Text>
            <Text style={[styles.lineAmount, styles.colAmount]}>{fmt(data.rampFees)}</Text>
          </View>
        )}

        {data.swapCount > 0 && (
          <View style={styles.tableRow}>
            <Text style={[styles.lineLabel, styles.colDesc]}>
              Swap fees · {data.swapCount} transactions
            </Text>
            <Text style={[styles.lineAmount, styles.colAmount]}>{fmt(data.swapFees)}</Text>
          </View>
        )}

        {data.bridgeCount > 0 && (
          <View style={styles.tableRow}>
            <Text style={[styles.lineLabel, styles.colDesc]}>
              Bridge fees · {data.bridgeCount} transactions
            </Text>
            <Text style={[styles.lineAmount, styles.colAmount]}>{fmt(data.bridgeFees)}</Text>
          </View>
        )}

        {data.transferCount > 0 && (
          <View style={styles.tableRow}>
            <Text style={[styles.lineLabel, styles.colDesc]}>
              Transfer fees · {data.transferCount} transactions
            </Text>
            <Text style={[styles.lineAmount, styles.colAmount]}>{fmt(data.transferFees)}</Text>
          </View>
        )}

        {data.paymentCount > 0 && (
          <View style={styles.tableRow}>
            <Text style={[styles.lineLabel, styles.colDesc]}>
              Payment fees · {data.paymentCount} transactions
            </Text>
            <Text style={[styles.lineAmount, styles.colAmount]}>{fmt(data.paymentFees)}</Text>
          </View>
        )}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total due</Text>
          <Text style={styles.totalAmount}>{fmt(total)}</Text>
        </View>

        {data.cardLast4 && (
          <View style={{ marginTop: 20 }}>
            <Text style={{ fontFamily: PDF_TYPE.family, fontSize: PDF_TYPE.small, color: PDF_COLORS.text400 }}>
              Charged to card ending in {data.cardLast4}.
            </Text>
          </View>
        )}

        <View style={PDF_STYLES.footer} fixed>
          <Image src={PDF_LOGO_SRC} style={PDF_STYLES.logoFooter} />
          <Text style={PDF_STYLES.footerText}>
            Detailed transaction records at app.vantor.xyz
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf data={data} />);
}

export { InvoicePdf };
