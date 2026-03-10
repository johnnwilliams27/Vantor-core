import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Vantor – Agentic Stablecoin Treasury Management',
  description: 'Manage USDC, USDT, and PYUSD treasury operations on Ethereum and Solana',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
