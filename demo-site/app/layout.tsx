import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Latitude | Blue Shell Concept',
  description: 'Independent, unofficial Latitude product concept. All accounts, transactions and balances are simulated.',
  robots: { index: false, follow: false },
};
export default function RootLayout({children}: {children: ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
