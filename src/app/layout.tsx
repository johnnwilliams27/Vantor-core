import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Vantor – Agentic Stablecoin Treasury Management',
  description:
    'Connect ERP systems with digital asset wallets and bank accounts for agentic treasury management. AI-powered yield optimization, compliance, and cash flow forecasting.',
  metadataBase: new URL('https://vantor.xyz'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Vantor – Agentic Stablecoin Treasury Management',
    description:
      'Connect ERP systems with digital asset wallets and bank accounts for agentic treasury management. AI-powered yield optimization, compliance, and cash flow forecasting.',
    siteName: 'Vantor',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vantor – Agentic Stablecoin Treasury Management',
    description:
      'Connect ERP systems with digital asset wallets and bank accounts for agentic treasury management.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
