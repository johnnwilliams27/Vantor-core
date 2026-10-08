import type { Metadata } from 'next';
import { DemoApplication } from '@/components/demo/DemoApplication';

export const metadata: Metadata = {
  title: 'Interactive Demo – Vantor',
  description: 'Explore a simulated Vantor treasury workspace with no account required.',
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <DemoApplication />;
}
