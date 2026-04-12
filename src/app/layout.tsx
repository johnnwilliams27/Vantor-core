import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Vantor – Agentic Treasury Management',
  description:
    'Connect ERP systems with digital asset wallets and bank accounts for agentic treasury management. AI-powered yield optimization, compliance, and cash flow forecasting.',
  metadataBase: new URL('https://vantor.xyz'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Vantor – Agentic Treasury Management',
    description:
      'Connect ERP systems with digital asset wallets and bank accounts for agentic treasury management. AI-powered yield optimization, compliance, and cash flow forecasting.',
    siteName: 'Vantor',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vantor – Agentic Treasury Management',
    description:
      'Connect ERP systems with digital asset wallets and bank accounts for agentic treasury management.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-BJPZHG3J9S"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-BJPZHG3J9S');
          `}
        </Script>
      </head>
      <body className={`${inter.className} ${plusJakarta.variable}`}>
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
