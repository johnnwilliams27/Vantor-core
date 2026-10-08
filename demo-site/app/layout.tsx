import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Vantor | Interactive Treasury Demo', description: 'Explore the fictional Vantor treasury workspace without an account.', robots: { index: false, follow: false } };
export default function RootLayout({children}: {children: ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
