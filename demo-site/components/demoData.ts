import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, BrainCircuit, TrendingUp, Gavel, CheckSquare, CreditCard,
  Send, ArrowLeftRight, GitBranchPlus, Banknote, Wallet, Building2, Plug,
  ShieldCheck, FileText, History, Shield, BarChart3, FileBarChart, Bell,
  Users, Settings,
} from 'lucide-react';

export type DemoRow = { id: string; name: string; detail: string; amount: string; status: string; date: string; network?: string };
export type DemoSurface = {
  title: string; description: string; headline: string; headlineLabel: string;
  supporting: string; supportingLabel: string; action?: string; rows: DemoRow[];
};
export type DemoNav = { slug: string; title: string; icon: LucideIcon };
export const DEMO_GROUPS: { name: string; items: DemoNav[] }[] = [
  { name: 'Overview', items: [
    { slug: 'dashboard', title: 'Dashboard', icon: LayoutDashboard },
    { slug: 'treasury', title: 'Treasury AI', icon: BrainCircuit },
    { slug: 'yield', title: 'Yield', icon: TrendingUp },
  ] },
  { name: 'Operations', items: [
    { slug: 'policy', title: 'Policy', icon: Gavel },
    { slug: 'approvals', title: 'Approvals', icon: CheckSquare },
    { slug: 'payments', title: 'Payments', icon: CreditCard },
    { slug: 'transfers', title: 'Transfers', icon: Send },
    { slug: 'swaps', title: 'Swaps', icon: ArrowLeftRight },
    { slug: 'bridges', title: 'Bridges', icon: GitBranchPlus },
    { slug: 'ramps', title: 'On/Off Ramps', icon: Banknote },
  ] },
  { name: 'Connections', items: [
    { slug: 'wallets', title: 'Wallets', icon: Wallet },
    { slug: 'bank-accounts', title: 'Bank Accounts', icon: Building2 },
    { slug: 'erp', title: 'ERP Systems', icon: Settings },
    { slug: 'integrations', title: 'External Integrations', icon: Plug },
  ] },
  { name: 'Records & Reporting', items: [
    { slug: 'compliance', title: 'Compliance', icon: ShieldCheck },
    { slug: 'invoices', title: 'Invoices', icon: FileText },
    { slug: 'transactions', title: 'Transactions', icon: History },
    { slug: 'audit', title: 'Audit Trail', icon: Shield },
    { slug: 'analytics', title: 'Analytics', icon: BarChart3 },
    { slug: 'reporting', title: 'Reporting', icon: FileBarChart },
  ] },
  { name: 'Workspace', items: [
    { slug: 'notifications', title: 'Notifications', icon: Bell },
    { slug: 'accounts', title: 'Account Management', icon: Users },
    { slug: 'billing', title: 'Billing', icon: CreditCard },
  ] },
];

const row = (id: string, name: string, detail: string, amount: string, status: string, date: string, network?: string): DemoRow =>
  ({ id, name, detail, amount, status, date, network });

export const DEMO_SURFACES: Record<string, DemoSurface> = {
  dashboard: { title: 'Dashboard', description: 'A unified view of enterprise liquidity, yield and treasury activity.', headline: '$4,218,350', headlineLabel: 'Total treasury assets', supporting: '+8.4%', supportingLabel: 'Treasury growth · 90 days', rows: [
    row('db-1','USDC · Ethereum','Main treasury wallet','$1,000,000','Healthy','Today','Ethereum'), row('db-2','USD · JPMorgan','Primary operating account','$450,000','Healthy','Today','Bank'), row('db-3','USDC · Solana','Solana treasury wallet','$275,000','Healthy','Today','Solana'), row('db-4','EUR · Deutsche Bank','EU reserve account','€500,000','Healthy','Yesterday','Bank'),
  ] },
  treasury: { title: 'Treasury AI', description: 'Proactive liquidity monitoring, forecasting and decision recommendations.', headline: '$1,140,000', headlineLabel: 'Available deployable liquidity', supporting: '3', supportingLabel: 'Recommendations awaiting review', action: 'Run simulation', rows: [
    row('tr-1','Rebalance idle reserves','Deploy surplus USDC to low-risk yield','$225,000','Recommended','Today','Ethereum'), row('tr-2','Upcoming vendor obligations','Cash coverage for projected outflows','$315,000','Covered','Tomorrow','USD'), row('tr-3','Concentration warning','USDC exposure exceeds policy target','62%','Attention','Today','All chains'), row('tr-4','Maintain operating buffer','Keep 30-day outflow reserve','$420,000','Healthy','Today','USD'),
  ] },
  yield: { title: 'Yield', description: 'Monitor on-chain and off-chain yield positions without exposing real funds.', headline: '$1,375,000', headlineLabel: 'Simulated earning assets', supporting: '4.8%', supportingLabel: 'Illustrative blended APY', action: 'Simulate deposit', rows: [
    row('yi-1','Aave V3','USDC lending position','$650,000','Earning','Today','Ethereum'), row('yi-2','Kamino','USDC lending vault','$325,000','Earning','Today','Solana'), row('yi-3','Morpho','Conservative lending vault','$275,000','Earning','Today','Ethereum'), row('yi-4','Treasury yield reserve','Unallocated yield balance','$125,000','Available','Today','USDC'),
  ] },
  policy: { title: 'Policy', description: 'Set controls that govern treasury movements, hard limits and approvals.', headline: '3', headlineLabel: 'Active policy controls', supporting: 'v3', supportingLabel: 'Current simulated policy version', action: 'Simulate policy', rows: [
    row('po-1','Minimum cash reserve','Maintain operating liquidity','$100,000','Active','Oct 6','USD'), row('po-2','Maximum daily outflow','Limit total outbound transfers','$2,000,000','Active','Oct 6','USD'), row('po-3','Asset concentration','Maximum single-asset exposure','60%','Active','Oct 6','Portfolio'), row('po-4','Dual approval','Require two approvers for large movements','$500,000','Active','Oct 6','Workflow'),
  ] },
  approvals: { title: 'Approvals', description: 'Review operations requiring treasury and finance authorization.', headline: '2', headlineLabel: 'Pending requests', supporting: '4', supportingLabel: 'Recently resolved', action: 'Create sample request', rows: [
    row('ap-1','Reserve transfer','Morgan Lee · Treasury','$175,000','Pending','Today','Ethereum'), row('ap-2','Yield allocation','Alex Chen · Finance','$250,000','Pending','Today','Solana'), row('ap-3','Vendor settlement','Morgan Lee · Treasury','$88,450','Approved','Yesterday','USD'), row('ap-4','Large external transfer','Taylor Brooks · Finance','$540,000','Denied','Oct 3','Ethereum'),
  ] },
  payments: { title: 'Payments', description: 'Track fiat and digital-asset vendor settlements in one place.', headline: '$482,950', headlineLabel: 'Processed this month', supporting: '12', supportingLabel: 'Payments this month', action: 'New payment', rows: [
    row('pay-1','Northstar Cloud','INV-2026-042','$72,400','Completed','Today','USD'), row('pay-2','Atlas Logistics','INV-2026-041','$38,250','Processing','Yesterday','USDC'), row('pay-3','Summit Infrastructure','INV-2026-038','$116,800','Scheduled','Oct 10','USD'), row('pay-4','Bluewater Consulting','INV-2026-036','$22,600','Completed','Oct 2','USDT'),
  ] },
  transfers: { title: 'Transfers', description: 'Simulate digital asset transfers and scheduled movements.', headline: '$312,850', headlineLabel: 'Transferred this month', supporting: '27', supportingLabel: 'Transfer records', action: 'New transfer', rows: [
    row('tf-1','Operations → Reserve','Treasury rebalance','$125,000','Completed','Today','Ethereum'), row('tf-2','Vendor payout','0xTEST…42ab','$52,850','Processing','Today','Ethereum'), row('tf-3','Solana payments wallet','TESTso1…G29k','$35,000','Scheduled','Oct 9','Solana'), row('tf-4','Cross-border supplier','0xTEST…15ef','$100,000','Completed','Oct 3','Ethereum'),
  ] },
  swaps: { title: 'Swaps', description: 'Explore stablecoin conversions and route selection.', headline: '$685,000', headlineLabel: 'Simulated 30-day swap volume', supporting: '0.07%', supportingLabel: 'Illustrative average execution cost', action: 'Simulate swap', rows: [
    row('sw-1','USDT → USDC','Ethereum · 1inch route','$175,000','Completed','Today','Ethereum'), row('sw-2','USDC → USDT','Solana · Jupiter route','$100,000','Completed','Yesterday','Solana'), row('sw-3','USDT → USDC','Ethereum · best route','$250,000','Completed','Oct 4','Ethereum'), row('sw-4','USDC → USDT','Solana · pending quote','$160,000','Quoted','Oct 3','Solana'),
  ] },
  bridges: { title: 'Bridges', description: 'Monitor simulated cross-chain treasury movements.', headline: '$910,000', headlineLabel: 'Cross-chain volume', supporting: '6', supportingLabel: 'Recent bridge movements', action: 'Simulate bridge', rows: [
    row('br-1','Ethereum → Solana','USDC bridge','$250,000','Completed','Today','USDC'), row('br-2','Solana → Ethereum','USDC bridge','$125,000','Completed','Yesterday','USDC'), row('br-3','Ethereum → Solana','USDT route','$85,000','Processing','Oct 5','USDT'), row('br-4','Solana → Ethereum','USDC route','$450,000','Completed','Oct 2','USDC'),
  ] },
  ramps: { title: 'On/Off Ramps', description: 'Explore settlement between bank accounts and digital assets.', headline: '$1,420,000', headlineLabel: '30-day simulated ramp volume', supporting: '20', supportingLabel: 'Fiat settlement records', action: 'Simulate conversion', rows: [
    row('ra-1','USD → USDC','JPMorgan primary','$200,000','Completed','Today','USD'), row('ra-2','USDC → USD','Mercury operating','$125,000','Completed','Yesterday','USD'), row('ra-3','EUR → USDC','Deutsche Bank EU','€90,000','Pending','Oct 5','EUR'), row('ra-4','USDT → USD','JPMorgan primary','$75,000','Completed','Oct 3','USD'),
  ] },
  wallets: { title: 'Wallets', description: 'Monitor simulated Ethereum and Solana wallets with token-level holdings.', headline: '$2,150,000', headlineLabel: 'On-chain treasury balances', supporting: '5', supportingLabel: 'Connected demo wallets', action: 'Inspect wallet', rows: [
    row('wa-1','Treasury Main','0xTEST111…11aa','$1,175,000','Verified','Today','Ethereum'), row('wa-2','Operations','0xTEST222…22bb','$150,000','Verified','Today','Ethereum'), row('wa-3','Reserve','0xTEST333…33cc','$500,000','Verified','Today','Ethereum'), row('wa-4','Solana Treasury','TESTso1ana…1111','$275,000','Verified','Today','Solana'), row('wa-5','Solana Payments','TESTso1ana…2222','$50,000','Verified','Today','Solana'),
  ] },
  'bank-accounts': { title: 'Bank Accounts', description: 'Consolidate multi-currency banking positions in your treasury workspace.', headline: '$2,068,350', headlineLabel: 'Illustrative fiat balances · USD equivalent', supporting: '9', supportingLabel: 'Demo bank accounts', action: 'Inspect account', rows: [
    row('ba-1','JPMorgan Chase','Primary Operating · ••4521','$450,000','Connected','Today','USD'), row('ba-2','Silicon Valley Bank','Reserves · ••7832','$1,200,000','Connected','Today','USD'), row('ba-3','Mercury','Startup Ops · ••1290','$85,000','Connected','Today','USD'), row('ba-4','Barclays','EUR Operations · ••6614','€320,000','Connected','Today','EUR'), row('ba-5','HSBC','GBP Account · ••5507','£175,000','Connected','Today','GBP'), row('ba-6','Deutsche Bank','EU Reserves · ••3341','€500,000','Connected','Today','EUR'),
  ] },
  erp: { title: 'ERP Systems', description: 'See how payables, vendor records and general ledgers flow into Vantor.', headline: '2', headlineLabel: 'Connected simulated ERP systems', supporting: '18', supportingLabel: 'Synced vendor invoices', action: 'Preview sync', rows: [
    row('erp-1','NetSuite','Accounts payable + general ledger','18 invoices','Connected','Today','ERP'), row('erp-2','Xero','Invoice and vendor synchronization','12 vendors','Connected','Today','ERP'), row('erp-3','SAP S/4HANA','Available connector','—','Available','—','ERP'), row('erp-4','Oracle ERP','Available connector','—','Available','—','ERP'),
  ] },
  integrations: { title: 'External Integrations', description: 'Explore banking, compliance and operational integrations.', headline: '4', headlineLabel: 'Configured demo integrations', supporting: '7', supportingLabel: 'Available integration categories', action: 'Preview integration', rows: [
    row('int-1','Chainalysis','Blockchain transaction monitoring','KYT','Connected','Today','Compliance'), row('int-2','Slack','Treasury notifications','Alerts','Connected','Today','Messaging'), row('int-3','Xero','Accounting integration','ERP','Connected','Today','Accounting'), row('int-4','Stripe','Fiat and billing services','Payments','Demo only','Today','Banking'),
  ] },
  compliance: { title: 'Compliance', description: 'Examine sanctions screening, KYT alerts and travel-rule records.', headline: '98.7%', headlineLabel: 'Transactions screened', supporting: '2', supportingLabel: 'Alerts requiring review', action: 'Run sample screening', rows: [
    row('co-1','High-value outbound transfer','Behavioral KYT signal','$175,000','Review','Today','Ethereum'), row('co-2','New counterparty','Sanctions screening','0 matches','Clear','Today','Solana'), row('co-3','Large incoming wallet transfer','Monitoring rule','$220,000','Review','Yesterday','Ethereum'), row('co-4','Travel rule review','Cross-border payment','$38,250','Clear','Oct 4','USDC'),
  ] },
  invoices: { title: 'Invoices', description: 'Track payables from ERP ingestion through settlement.', headline: '$738,400', headlineLabel: 'Outstanding payables', supporting: '18', supportingLabel: 'Synced invoices', action: 'Preview invoice', rows: [
    row('inv-1','Atlas Logistics','INV-2026-041','$38,250','Pending','Oct 12','USD'), row('inv-2','Summit Infrastructure','INV-2026-038','$116,800','Approved','Oct 15','USD'), row('inv-3','Northstar Cloud','INV-2026-042','$72,400','Paid','Oct 7','USDC'), row('inv-4','Bluewater Consulting','INV-2026-036','$22,600','Paid','Oct 3','USDT'), row('inv-5','Horizon Systems','INV-2026-035','$84,600','Overdue','Oct 1','USD'),
  ] },
  transactions: { title: 'Transactions', description: 'Audit all simulated on-chain and fiat asset movements.', headline: '84', headlineLabel: 'Recent transactions', supporting: '3', supportingLabel: 'Networks and payment rails', action: 'Export CSV', rows: [
    row('tx-1','USDC received','0xTEST…ab17','$250,000','Confirmed','Today','Ethereum'), row('tx-2','Reserve allocation','TESTso…ga10','$72,000','Confirmed','Today','Solana'), row('tx-3','Vendor payout','0xTEST…e261','$38,250','Confirmed','Yesterday','Ethereum'), row('tx-4','Bank settlement','JPMorgan · ••4521','$125,000','Completed','Oct 4','USD'),
  ] },
  audit: { title: 'Audit Trail', description: 'Review sample activity records, actors and decision histories.', headline: '247', headlineLabel: 'Audit records · 90 days', supporting: '100%', supportingLabel: 'Actions logged in the demo', action: 'Export CSV', rows: [
    row('au-1','Policy evaluated','Morgan Lee · Treasury','POL-1032','Allowed','Today','Policy'), row('au-2','Transfer submitted','Alex Chen · Finance','TX-7421','Recorded','Today','Transfer'), row('au-3','Approval recorded','Taylor Brooks · Finance','APR-307','Recorded','Yesterday','Approvals'), row('au-4','ERP synchronized','System agent','SYNC-991','Recorded','Oct 5','ERP'),
  ] },
  analytics: { title: 'Analytics', description: 'Analyze historical liquidity, asset mix and cash-flow performance.', headline: '+8.4%', headlineLabel: '90-day treasury growth', supporting: '4.8%', supportingLabel: 'Illustrative yield rate', action: 'Export CSV', rows: [
    row('an-1','Liquidity over time','Portfolio value by day','$4.22M','Updated','Today','Portfolio'), row('an-2','Cash-flow forecast','Projected inflows and outflows','90 days','Updated','Today','Forecast'), row('an-3','Asset allocation','Crypto vs fiat distribution','51% / 49%','Updated','Today','Portfolio'), row('an-4','Yield earned','Income across deployed positions','$5,486','Updated','Today','Yield'),
  ] },
  reporting: { title: 'Reporting', description: 'Preview shareable treasury, operations and compliance reporting.', headline: '6', headlineLabel: 'Available report templates', supporting: 'Oct 2026', supportingLabel: 'Current simulated reporting period', action: 'Export CSV', rows: [
    row('re-1','Treasury position report','Balances, networks and currency exposures','Portfolio','Ready','Today','Treasury'), row('re-2','Liquidity forecast','Expected inflows and outflows','90-day','Ready','Today','Forecast'), row('re-3','Payments register','Vendor settlements and fees','Monthly','Ready','Today','Payments'), row('re-4','Compliance register','Screening and policy evidence','Monthly','Ready','Today','Compliance'),
  ] },
  notifications: { title: 'Notifications', description: 'Monitor demo alerts and treasury event updates.', headline: '3', headlineLabel: 'Unread alerts', supporting: '10', supportingLabel: 'Recent notifications', action: 'Mark all as read', rows: [
    row('no-1','Approval requested','Reserve transfer requires review','$175,000','Unread','Today','Operations'), row('no-2','New treasury insight','Potential yield optimization','$225,000','Unread','Today','Treasury'), row('no-3','KYT alert','Large on-chain transaction','High','Unread','Yesterday','Compliance'), row('no-4','ERP synchronization','NetSuite import completed','18 invoices','Read','Yesterday','ERP'),
  ] },
  accounts: { title: 'Account Management', description: 'Preview roles, user access and approval assignments.', headline: '4', headlineLabel: 'Sample enterprise members', supporting: '3', supportingLabel: 'Permission roles', action: 'Inspect user', rows: [
    row('ac-1','Morgan Lee','morgan@example.demo','Treasury manager','Active','Today','Treasury'), row('ac-2','Alex Chen','alex@example.demo','Accountant','Active','Today','Finance'), row('ac-3','Taylor Brooks','taylor@example.demo','Executive','Active','Today','Executive'), row('ac-4','Jordan Patel','jordan@example.demo','Auditor','Active','Today','Compliance'),
  ] },
  billing: { title: 'Billing', description: 'Review illustrative subscription options without checkout or payment.', headline: 'Enterprise', headlineLabel: 'Demo workspace plan', supporting: '$0', supportingLabel: 'Chargeable demo activity', action: 'Compare plans', rows: [
    row('bi-1','Lite','Explore test mode','Free','Available','Now','Plan'), row('bi-2','Starter','Smaller treasury teams','Custom','Illustrative','Now','Plan'), row('bi-3','Growth','Scaling payment operations','Custom','Illustrative','Now','Plan'), row('bi-4','Enterprise','Advanced controls and support','Custom','Demo plan','Now','Plan'),
  ] },
};

export const LIQUIDITY_POINTS = [
  { day: 'Jul 10', total: 3.89, cash: 1.86 }, { day: 'Jul 25', total: 3.94, cash: 1.92 },
  { day: 'Aug 9', total: 4.02, cash: 1.97 }, { day: 'Aug 24', total: 3.99, cash: 1.95 },
  { day: 'Sep 8', total: 4.13, cash: 2.02 }, { day: 'Sep 23', total: 4.10, cash: 2.04 },
  { day: 'Oct 7', total: 4.22, cash: 2.07 },
];
export const ASSET_MIX = [
  { name: 'USDC', value: 1725000, color: '#2dd4bf' },
  { name: 'USDT', value: 425000, color: '#22a6bf' },
  { name: 'USD', value: 1735000, color: '#7078f3' },
  { name: 'EUR / GBP', value: 333350, color: '#a88ee8' },
];
export const CASH_FLOW = [
  { month: 'May', inflow: 530, outflow: 420 }, { month: 'Jun', inflow: 610, outflow: 490 },
  { month: 'Jul', inflow: 550, outflow: 510 }, { month: 'Aug', inflow: 680, outflow: 530 },
  { month: 'Sep', inflow: 740, outflow: 615 }, { month: 'Oct', inflow: 710, outflow: 570 },
];
