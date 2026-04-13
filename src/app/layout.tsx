import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Providers } from './providers';

// Satoshi loaded via Fontshare CDN in <head> — see style guide Section 11.
// Future stage: migrate to next/font/local with bundled OTF for better
// performance. plusJakarta kept for existing --font-display surfaces;
// schedule removal in a follow-up once display usages migrate.
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
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"
        />
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
      <body className={`font-sans ${plusJakarta.variable}`}>
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
