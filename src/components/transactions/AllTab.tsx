'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ChainBadge } from '@/components/ui/icons/chain-logos';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';
import { TruncatedAddress } from '@/components/ui/truncated-address';
import type { Transfer, Swap, FiatTransaction, YieldTransaction, BridgeTransfer, Wallet } from '@/types/database';
import type { FiatPayment } from '@/types/fiat-payments';
import { useWallets } from '@/hooks/useWallets';

interface UnifiedRow {
  id: string;
  type: 'transfer' | 'swap' | 'ramp' | 'bridge' | 'yield' | 'payment';
  date: string;
  amount: string;
  currency: string;
  chain: string | null;
  status: string;
  /**
   * Text representation of the from/to party for search + CSV export.
   * If the party is a raw address (no label), `fromAddress` / `toAddress`
   * carries the full address so the table cell can render a TruncatedAddress
   * with copy + expand instead of a plain truncated string.
   */
  from: string;
  to: string;
  fromAddress?: string;
  toAddress?: string;
  fee: string | null;
  rate: string | null;
  memo: string | null;
  details: Record<string, string>;
}

function walletLabel(wallet?: { label?: string | null; address: string } | null): string {
  if (!wallet) return '—';
  return wallet.label || `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
}

/** Returns the raw address iff the wallet has no label (so the render site
 *  can substitute a TruncatedAddress). Returns undefined when the wallet
 *  will display as a label, or when the wallet is missing entirely. */
function walletRawAddress(wallet?: { label?: string | null; address: string } | null): string | undefined {
  if (!wallet) return undefined;
  return wallet.label ? undefined : wallet.address;
}

function mapTransfers(transfers: Transfer[]): UnifiedRow[] {
  return transfers.map((p) => {
    const isSent = p.direction === 'sent';
    const walletName = walletLabel(p.from_wallet);
    const walletRaw = walletRawAddress(p.from_wallet);
    const externalRaw = isSent ? p.to_address : p.from_address;
    const externalDisplay = externalRaw
      ? `${externalRaw.slice(0, 6)}…${externalRaw.slice(-4)}`
      : '—';

    return {
    id: `transfer-${p.id}`,
    type: 'transfer',
    date: p.created_at,
    amount: p.amount,
    currency: p.token,
    chain: p.chain,
    status: p.status,
    from: isSent ? walletName : externalDisplay,
    to: isSent ? externalDisplay : walletName,
    fromAddress: isSent ? walletRaw : (externalRaw ?? undefined),
    toAddress: isSent ? (externalRaw ?? undefined) : walletRaw,
    fee: null,
    rate: null,
    memo: p.memo ?? null,
    details: {
      'Direction': isSent ? 'Sent' : 'Received',
      ...(p.scheduled_for ? { 'Scheduled For': formatDateTime(p.scheduled_for) } : {}),
      ...(p.tx_hash ? { 'TX Hash': p.tx_hash } : {}),
      ...(p.erp_config ? { 'ERP': p.erp_config.provider.toUpperCase() } : {}),
    },
  };
  });
}

function mapSwaps(swaps: Swap[]): UnifiedRow[] {
  return swaps.map((s) => ({
    id: `swap-${s.id}`,
    type: 'swap',
    date: s.created_at,
    amount: s.to_amount ?? s.from_amount,
    currency: `${s.from_token} → ${s.to_token}`,
    chain: s.chain,
    status: s.status,
    from: walletLabel(s.wallet),
    to: walletLabel(s.wallet),
    fromAddress: walletRawAddress(s.wallet),
    toAddress: walletRawAddress(s.wallet),
    fee: null,
    rate: s.rate ?? null,
    memo: (s as any).memo ?? null,
    details: {
      'You Pay': `${formatCurrency(s.from_amount)} ${s.from_token}`,
      'You Receive': `${formatCurrency(s.to_amount ?? s.from_amount)} ${s.to_token}`,
      ...(s.rate ? { 'Rate': parseFloat(s.rate).toFixed(4) } : {}),
      ...(s.tx_hash ? { 'TX Hash': s.tx_hash } : {}),
    },
  }));
}

function mapBridges(bridges: BridgeTransfer[]): UnifiedRow[] {
  return bridges.map((b) => ({
    id: `bridge-${b.id}`,
    type: 'bridge',
    date: b.created_at,
    amount: b.received_amount ?? b.amount,
    currency: b.token,
    chain: `${capitalize(b.from_chain)} → ${capitalize(b.to_chain)}`,
    status: b.status,
    from: walletLabel(b.from_wallet),
    to: walletLabel(b.to_wallet),
    fromAddress: walletRawAddress(b.from_wallet),
    toAddress: walletRawAddress(b.to_wallet),
    fee: b.bridge_fee && parseFloat(b.bridge_fee) > 0 ? `${parseFloat(b.bridge_fee).toFixed(4)} ${b.token}` : null,
    rate: null,
    memo: (b as any).memo ?? null,
    details: {
      'Sent': `${formatCurrency(b.amount)} ${b.token}`,
      'Received': b.received_amount ? `${formatCurrency(b.received_amount)} ${b.token}` : '—',
      ...(b.bridge_fee && parseFloat(b.bridge_fee) > 0 ? { 'Bridge Fee': `${parseFloat(b.bridge_fee).toFixed(4)} ${b.token}` } : {}),
      ...(b.estimated_arrival_minutes ? { 'Est. Arrival': `~${b.estimated_arrival_minutes} min` } : {}),
      ...(b.tx_hash ? { 'TX Hash': b.tx_hash } : {}),
    },
  }));
}

function mapRamps(ramps: FiatTransaction[], wallets?: Wallet[]): UnifiedRow[] {
  return ramps.map((r) => {
    const bankName = r.bank_account
      ? `${r.bank_account.nickname || r.bank_account.institution_name}${r.bank_account.last4 ? ` ****${r.bank_account.last4}` : ''}`
      : '—';
    const wLabel = walletLabel(wallets?.[0]);
    const isOfframp = r.direction === 'offramp';
    const fiatFormatted = parseFloat(r.fiat_amount).toLocaleString(undefined, { style: 'currency', currency: r.fiat_currency });
    return {
      id: `ramp-${r.id}`,
      type: 'ramp',
      date: r.created_at,
      amount: isOfframp ? r.fiat_amount : r.crypto_amount,
      currency: isOfframp ? `${r.crypto_token} → ${r.fiat_currency}` : `${r.fiat_currency} → ${r.crypto_token}`,
      chain: null,
      status: r.status,
      from: isOfframp ? wLabel : bankName,
      to: isOfframp ? bankName : wLabel,
      fee: r.fee_amount && parseFloat(r.fee_amount) > 0 ? parseFloat(r.fee_amount).toLocaleString(undefined, { style: 'currency', currency: r.fiat_currency }) : null,
      rate: r.exchange_rate ? parseFloat(r.exchange_rate).toFixed(4) : null,
      memo: (r as any).memo ?? null,
      details: {
        'Direction': isOfframp ? 'Off-ramp (Wallet → Bank)' : 'On-ramp (Bank → Wallet)',
        'Stablecoin': `${formatCurrency(r.crypto_amount)} ${r.crypto_token}`,
        'Bank Amount': fiatFormatted,
        'Bank': bankName,
        'Wallet': wLabel,
        ...(r.exchange_rate ? { 'Rate': parseFloat(r.exchange_rate).toFixed(4) } : {}),
        ...(r.fee_amount && parseFloat(r.fee_amount) > 0 ? { 'Fee': parseFloat(r.fee_amount).toLocaleString(undefined, { style: 'currency', currency: r.fiat_currency }) } : {}),
      },
    };
  });
}

function mapYield(txs: YieldTransaction[]): UnifiedRow[] {
  return txs.map((y) => ({
    id: `yield-${y.id}`,
    type: 'yield',
    date: y.executed_at ?? y.created_at,
    amount: y.amount,
    currency: y.underlying_token,
    chain: y.chain,
    status: y.status,
    from: y.tx_type === 'deposit' ? 'Wallet' : y.protocol,
    to: y.tx_type === 'deposit' ? y.protocol : 'Wallet',
    fee: null,
    rate: null,
    memo: null,
    details: {
      'Protocol': y.protocol,
      'Type': y.tx_type === 'deposit' ? 'Deposit' : 'Withdraw',
      ...(y.tx_hash ? { 'TX Hash': y.tx_hash } : {}),
    },
  }));
}

function mapFiatPayments(payments: FiatPayment[]): UnifiedRow[] {
  return payments.map((p) => {
    const fromLabel = p.from_bank_account
      ? (p.from_bank_account.nickname || p.from_bank_account.institution_name) + (p.from_bank_account.last4 ? ` ****${p.from_bank_account.last4}` : '')
      : '—';
    const toLabel = `${p.to_account_holder} (${p.to_bank_name})`;
    return {
      id: `payment-${p.id}`,
      type: 'payment',
      date: p.created_at,
      amount: p.amount,
      currency: p.currency,
      chain: null,
      status: p.status,
      from: fromLabel,
      to: toLabel,
      fee: null,
      rate: null,
      memo: p.memo ?? null,
      details: {
        'From Bank': fromLabel,
        'To Bank': p.to_bank_name,
        'Account Holder': p.to_account_holder,
        'Amount': `${formatCurrency(p.amount)} ${p.currency}`,
        'Currency': p.currency,
        'Status': capitalize(p.status),
        ...(p.scheduled_for ? { 'Scheduled': formatDateTime(p.scheduled_for) } : {}),
        ...(p.executed_at ? { 'Executed': formatDateTime(p.executed_at) } : {}),
        ...(p.estimated_settlement ? { 'Est. Settlement': formatDateTime(p.estimated_settlement) } : {}),
        ...(p.settled_at ? { 'Settled': formatDateTime(p.settled_at) } : {}),
      },
    };
  });
}

// Migrated to semantic Badge variants (style guide Stage 3d).
// Categorical palette — hues differentiate types, not semantic status.
const TYPE_VARIANT: Record<UnifiedRow['type'], string> = {
  transfer: 'active',   // teal (was #19595b teal — matches brand)
  swap: 'inactive',     // gray
  ramp: 'pending',      // amber
  bridge: 'info-blue',  // blue
  yield: 'live',        // green (kept green — yield/earning signals "running")
  payment: 'special',   // purple
};

const ALL_EXPORT_COLUMNS: ExportColumn<UnifiedRow>[] = [
  { header: 'Type', accessor: (r) => capitalize(r.type) },
  { header: 'From', accessor: (r) => r.from },
  { header: 'To', accessor: (r) => r.to },
  { header: 'Amount', accessor: (r) => formatCurrency(r.amount) },
  { header: 'Currency', accessor: (r) => r.currency },
  { header: 'Chain', accessor: (r) => r.chain ? capitalize(r.chain) : '' },
  { header: 'Fee', accessor: (r) => r.fee ?? '' },
  { header: 'Rate', accessor: (r) => r.rate ?? '' },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
  { header: 'Date', accessor: (r) => formatDateTime(r.date) },
];

const ALL_FILTER_CONFIG = {
  searchFields: [
    'from' as const,
    'to' as const,
    'currency' as const,
    'type' as const,
  ],
  dropdowns: [
    { key: 'type', accessor: (item: UnifiedRow) => item.type },
    { key: 'status', accessor: (item: UnifiedRow) => item.status },
    { key: 'chain', accessor: (item: UnifiedRow) => item.chain ?? 'N/A' },
  ],
  dateField: (item: UnifiedRow) => item.date,
};

export function AllTab() {
  const [selectedRow, setSelectedRow] = useState<UnifiedRow | null>(null);
  const { data: wallets } = useWallets();

  const { data, isLoading } = useQuery<UnifiedRow[]>({
    queryKey: ['unified-transactions', wallets?.length],
    queryFn: async () => {
      const [p, s, r, b, y, fp] = await Promise.allSettled([
        fetch('/api/transfers').then((res) => res.json()),
        fetch('/api/swaps').then((res) => res.json()),
        fetch('/api/ramps').then((res) => res.json()),
        fetch('/api/bridges').then((res) => res.json()),
        fetch('/api/yield/transactions').then((res) => res.json()),
        fetch('/api/payments').then((res) => res.json()),
      ]);

      const transfers: Transfer[] = p.status === 'fulfilled' ? (p.value.data ?? []) : [];
      const swaps: Swap[] = s.status === 'fulfilled' ? (s.value.data ?? []) : [];
      const ramps: FiatTransaction[] = r.status === 'fulfilled' ? (r.value.data ?? []) : [];
      const bridges: BridgeTransfer[] = b.status === 'fulfilled' ? (b.value.data ?? []) : [];
      const yieldTxs: YieldTransaction[] = y.status === 'fulfilled' ? (y.value.data ?? []) : [];
      const fiatPayments: FiatPayment[] = fp.status === 'fulfilled' ? (fp.value.data ?? []) : [];

      const all: UnifiedRow[] = [
        ...mapTransfers(transfers),
        ...mapSwaps(swaps),
        ...mapRamps(ramps, wallets),
        ...mapBridges(bridges),
        ...mapYield(yieldTxs),
        ...mapFiatPayments(fiatPayments),
      ];

      return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, ALL_FILTER_CONFIG);

  if (isLoading) {
    return <TableCardSkeleton columns={8} rows={5} />;
  }

  return (
    <>
    <Card>
      <CardHeader><CardTitle>All Activity</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search transactions..."
          dropdowns={[
            { key: 'type', label: 'Type', options: filter.dropdownOptions.type ?? [] },
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
            { key: 'chain', label: 'Chain', options: filter.dropdownOptions.chain ?? [] },
          ]}
          filters={filter.filters}
          onFilterChange={filter.setFilter}
          showDateRange
          dateFrom={filter.dateFrom}
          dateTo={filter.dateTo}
          onDateFromChange={filter.setDateFrom}
          onDateToChange={filter.setDateTo}
          resultCount={filter.filteredData.length}
          totalCount={filter.totalCount}
          activeFilterCount={filter.activeFilterCount}
          onClear={filter.clearAll}
          onExportCsv={() => exportCsv('transactions', ALL_EXPORT_COLUMNS, filter.filteredData)}
          onExportPdf={() => exportPdf('transactions', 'All Transactions', ALL_EXPORT_COLUMNS, filter.filteredData)}
        />
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filter.pagedData.length ? (
              filter.pagedData.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedRow(row)}
                >
                  <TableCell>
                    <Badge variant={TYPE_VARIANT[row.type] as any}>
                      {capitalize(row.type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.fromAddress ? <TruncatedAddress address={row.fromAddress} /> : row.from}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.toAddress ? <TruncatedAddress address={row.toAddress} /> : row.to}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="font-semibold">{formatCurrency(row.amount)}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="outline">{row.currency}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.chain ? (
                      row.chain.includes('→') ? (
                        <div className="flex items-center gap-1">
                          {row.chain.split(' → ').map((c, i, arr) => (
                            <span key={i} className="flex items-center gap-1">
                              <ChainBadge chain={c.toLowerCase()} />
                              {i < arr.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <ChainBadge chain={row.chain} />
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant={
                      row.status === 'completed' ? 'active' :
                      row.status === 'failed' ? 'failed' :
                      'pending'
                    }>
                      {capitalize(row.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(row.date)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  {filter.activeFilterCount > 0 ? 'No matching transactions.' : 'No activity yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>

        <TablePagination
          page={filter.page}
          totalPages={filter.totalPages}
          pageSize={filter.pageSize}
          filteredCount={filter.filteredCount}
          onPageChange={filter.setPage}
          onPageSizeChange={filter.setPageSize}
        />
      </CardContent>
    </Card>

    {/* Transaction Detail Modal */}
    <Dialog open={!!selectedRow} onOpenChange={(o) => !o && setSelectedRow(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge variant={selectedRow ? TYPE_VARIANT[selectedRow.type] as any : 'default' as any}>
              {selectedRow ? capitalize(selectedRow.type) : ''}
            </Badge>
            Transaction Details
          </DialogTitle>
        </DialogHeader>
        {selectedRow && (
          <div className="space-y-3">
            {/* From → To */}
            <div className="bg-muted/40 rounded-md p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">From</span>
                <span className="font-medium text-right max-w-[200px] break-all">{selectedRow.from}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">To</span>
                <span className="font-medium text-right max-w-[200px] break-all">{selectedRow.to}</span>
              </div>
            </div>

            {/* Amount + Currency */}
            <div className="bg-muted/40 rounded-md p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatCurrency(selectedRow.amount)} {selectedRow.currency}</span>
              </div>
              {selectedRow.rate && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Rate</span>
                  <span>{selectedRow.rate}</span>
                </div>
              )}
              {selectedRow.fee && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Fee</span>
                  <span>{selectedRow.fee}</span>
                </div>
              )}
            </div>

            {/* Additional details */}
            {Object.keys(selectedRow.details).length > 0 && (
              <div className="bg-muted/40 rounded-md p-3 space-y-2">
                {Object.entries(selectedRow.details).map(([key, val]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{key}</span>
                    <span className={`text-right max-w-[200px] break-all ${key === 'TX Hash' ? 'font-mono text-xs' : ''}`}>{val}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Memo */}
            {selectedRow.memo && (
              <div className="border-l-2 border-primary pl-3 text-sm text-muted-foreground">
                {selectedRow.memo}
              </div>
            )}

            {/* Meta */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {selectedRow.chain && !selectedRow.chain.includes('→') ? capitalize(selectedRow.chain) : ''}
              </span>
              <span>{formatDateTime(selectedRow.date)}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
