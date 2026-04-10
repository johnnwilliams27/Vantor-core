import {
  BarChart3,
  TrendingUp,
  ShieldCheck,
  BrainCircuit,
  Banknote,
  Send,
  ArrowLeftRight,
  FileText,
  ShieldAlert,
  Coins,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type SectionId =
  | 'treasury-overview'
  | 'obligation-coverage'
  | 'recommendations'
  | 'ramp-history'
  | 'transfers'
  | 'swaps'
  | 'invoices'
  | 'compliance'
  | 'yield';

export interface SectionConfig {
  id: SectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  defaultEnabled: boolean;
}

export const SECTION_REGISTRY: SectionConfig[] = [
  {
    id: 'treasury-overview',
    label: 'Treasury Overview',
    description: 'Summary KPIs: balances, ramp totals, coverage ratio',
    icon: BarChart3,
    defaultEnabled: true,
  },
  {
    id: 'obligation-coverage',
    label: 'Obligation Coverage',
    description: 'Weekly coverage ratio chart',
    icon: ShieldCheck,
    defaultEnabled: true,
  },
  {
    id: 'recommendations',
    label: 'Actions Overview',
    description: 'Recommendation outcomes and reasoning',
    icon: BrainCircuit,
    defaultEnabled: true,
  },
  {
    id: 'ramp-history',
    label: 'Ramp History',
    description: 'On-ramp and off-ramp transaction history',
    icon: Banknote,
    defaultEnabled: true,
  },
  {
    id: 'transfers',
    label: 'Transfers',
    description: 'Transfer volume, status breakdown, execution details',
    icon: Send,
    defaultEnabled: false,
  },
  {
    id: 'swaps',
    label: 'Swaps',
    description: 'Token swap volume, pairs, and execution rates',
    icon: ArrowLeftRight,
    defaultEnabled: false,
  },
  {
    id: 'invoices',
    label: 'Invoices',
    description: 'Invoice aging, status breakdown, vendor analysis',
    icon: FileText,
    defaultEnabled: false,
  },
  {
    id: 'compliance',
    label: 'Compliance',
    description: 'Sanctions screenings and KYT alerts',
    icon: ShieldAlert,
    defaultEnabled: false,
  },
  {
    id: 'yield',
    label: 'Yield',
    description: 'Protocol positions, deposit/withdraw activity',
    icon: Coins,
    defaultEnabled: false,
  },
];

export const DEFAULT_SECTIONS = new Set<SectionId>(
  SECTION_REGISTRY.filter((s) => s.defaultEnabled).map((s) => s.id)
);
