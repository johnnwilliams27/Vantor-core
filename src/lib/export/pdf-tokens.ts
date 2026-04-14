import fs from 'fs';
import path from 'path';
import { StyleSheet } from '@react-pdf/renderer';
import './fonts';

/**
 * Resolve an asset for @react-pdf/renderer's `Image` component.
 *
 * In the browser, @react-pdf can fetch a URL string. On the server it
 * can't resolve Windows absolute paths (it tries to `fetch()` them and
 * fails), so we read the file and hand it a Buffer instead.
 *
 * We cache the buffer per path so repeat renders don't re-read from
 * disk on every invocation.
 */
const assetCache = new Map<string, Buffer>();

export function resolvePdfAsset(file: string): string | Buffer {
  if (typeof window !== 'undefined') {
    return `/${file}`;
  }
  const cached = assetCache.get(file);
  if (cached) return cached;
  const buf = fs.readFileSync(path.join(process.cwd(), 'public', file));
  assetCache.set(file, buf);
  return buf;
}

/**
 * Dark-teal wordmark, downsized (240×76) for PDF embedding — pairs with
 * the white PDF page background. Regenerate via `node scripts/build-pdf-logo.mjs`
 * whenever `public/logo-light.png` changes.
 */
export const PDF_LOGO_SRC = resolvePdfAsset('logo-light-pdf.png');

/**
 * Shared PDF design tokens. Mirrors the Vantor web style system but uses
 * a light-mode palette because PDFs are viewed and printed on white.
 * Brand teal stays identical to the product surface so invoices and reports
 * read as part of the same system.
 *
 * Rules of use:
 *  - import `PDF_COLORS` / `PDF_TYPE` for ad-hoc inline styles
 *  - import `PDF_STYLES` for the common page/table/header/footer blocks
 *  - never hardcode hex in section files — extend the token set instead
 */

export const PDF_COLORS = {
  brandTeal: '#2DD4BF',
  primaryL1: '#1A7F71',
  primaryL1Dark: '#115E56',

  bgPage: '#FFFFFF',
  bgCard: '#F8FAFC',
  bgTableHead: '#F1F5F9',
  bgRowAlt: '#FAFBFC',

  text100: '#0F172A',
  text200: '#334155',
  text300: '#475569',
  text400: '#64748B',
  text500: '#94A3B8',

  borderStrong: '#E2E8F0',
  borderSoft: '#F1F5F9',

  active:  { bg: '#DCFAF6', fg: '#0F766E' },
  pending: { bg: '#FEF3C7', fg: '#92400E' },
  failed:  { bg: '#FEE2E2', fg: '#991B1B' },
  info:    { bg: '#DBEAFE', fg: '#1E40AF' },
  agent:   { bg: '#EDE9FE', fg: '#5B21B6' },
} as const;

export const PDF_TYPE = {
  family: 'Satoshi',
  h1: 22,
  h2: 14,
  h3: 11,
  body: 10,
  small: 9,
  micro: 8,
  tiny: 7,
} as const;

export const PDF_STYLES = StyleSheet.create({
  page: {
    fontFamily: PDF_TYPE.family,
    fontSize: PDF_TYPE.body,
    color: PDF_COLORS.text100,
    backgroundColor: PDF_COLORS.bgPage,
    padding: 36,
    paddingBottom: 60,
  },

  brandRule: {
    height: 3,
    width: 36,
    backgroundColor: PDF_COLORS.primaryL1,
    marginBottom: 10,
  },
  logo: {
    width: 88,
    height: 28,
    marginBottom: 6,
  },
  logoFooter: {
    width: 54,
    height: 17,
  },

  header: {
    marginBottom: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.borderStrong,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  brand: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: 2,
    color: PDF_COLORS.primaryL1,
  },
  title: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: PDF_TYPE.h1,
    color: PDF_COLORS.text100,
    marginTop: 4,
    marginBottom: 3,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 400,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.text400,
  },

  sectionTitle: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: PDF_TYPE.h3,
    color: PDF_COLORS.text100,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
  },

  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  kpiCard: {
    width: '31%',
    backgroundColor: PDF_COLORS.bgCard,
    borderRadius: 8,
    borderLeftWidth: 2,
    borderLeftColor: PDF_COLORS.primaryL1,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  kpiLabel: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 500,
    fontSize: PDF_TYPE.micro,
    color: PDF_COLORS.text400,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  kpiValue: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: 13,
    color: PDF_COLORS.text100,
  },

  table: { marginTop: 2 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: PDF_COLORS.bgTableHead,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginBottom: 2,
  },
  th: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: PDF_TYPE.micro,
    color: PDF_COLORS.text300,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.borderSoft,
  },
  tableRowAlt: {
    backgroundColor: PDF_COLORS.bgRowAlt,
  },
  td: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 400,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.text200,
  },
  tdMuted: {
    color: PDF_COLORS.text500,
  },
  tdNumeric: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 500,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.text100,
    textAlign: 'right',
  },

  emptyNote: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 400,
    fontSize: PDF_TYPE.small,
    fontStyle: 'italic',
    color: PDF_COLORS.text500,
    marginVertical: 6,
  },

  footer: {
    position: 'absolute',
    left: 36,
    right: 36,
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.borderSoft,
    paddingTop: 8,
  },
  footerText: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 400,
    fontSize: PDF_TYPE.tiny,
    color: PDF_COLORS.text500,
  },
  footerBrand: {
    fontFamily: PDF_TYPE.family,
    fontWeight: 700,
    fontSize: PDF_TYPE.tiny,
    color: PDF_COLORS.primaryL1,
    letterSpacing: 1,
  },
});

export type PdfBadgeTone = 'active' | 'pending' | 'failed' | 'info' | 'agent';
