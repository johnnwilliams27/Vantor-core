'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { BalanceHint } from '@/components/ui/balance-hint';
import { FiatBalanceHint } from '@/components/ui/balance-hint';
import { useToast } from '@/components/ui/toast';
import { useWallets } from '@/hooks/useWallets';
import { useWalletTokenBalance } from '@/hooks/useBalances';
import { Loader2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Invoice, ErpConfiguration, BankAccount, Wallet } from '@/types/database';

/* ─── helpers ──────────────────────────────────────────────────────── */

const CRYPTO_CURRENCIES = ['USDC', 'USDT'];

function isCryptoInvoice(inv: Invoice): boolean {
  return CRYPTO_CURRENCIES.includes(inv.currency ?? inv.token ?? '');
}

function resolveToken(inv: Invoice): string {
  return inv.token ?? inv.currency ?? 'USDC';
}

function resolveDestination(inv: Invoice): string {
  return inv.destination_address ?? inv.vendor?.wallet_address ?? '';
}

function defaultMemo(inv: Invoice): string {
  const vendor = inv.vendor?.name ?? inv.vendor_name ?? '';
  return `Invoice ${inv.invoice_number}${vendor ? ` — ${vendor}` : ''}`;
}

/* ─── types ────────────────────────────────────────────────────────── */

interface Props {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ─── data fetchers ────────────────────────────────────────────────── */

async function fetchBankAccounts(): Promise<BankAccount[]> {
  const res = await fetch('/api/bank-accounts');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data ?? [];
}

async function fetchErpConfigs(): Promise<ErpConfiguration[]> {
  const res = await fetch('/api/erp/connect');
  const json = await res.json();
  if (!res.ok) return [];
  return (json.data ?? []).filter((c: ErpConfiguration) => c.is_active);
}

/* ─── component ────────────────────────────────────────────────────── */

export function PayInvoiceModal({ invoice, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── state ───────────────────────────────────────────────────────
  const [walletId, setWalletId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [toBankName, setToBankName] = useState('');
  const [toAccountHolder, setToAccountHolder] = useState('');
  const [toAccountNumber, setToAccountNumber] = useState('');
  const [toRoutingNumber, setToRoutingNumber] = useState('');
  const [erpConfigId, setErpConfigId] = useState('');
  const [memo, setMemo] = useState('');
  const [confirmStep, setConfirmStep] = useState(false);
  const [executing, setExecuting] = useState(false);

  // ── reset on open / invoice change ──────────────────────────────
  useEffect(() => {
    if (!invoice) return;
    setWalletId('');
    setBankAccountId('');
    setDestinationAddress(resolveDestination(invoice));
    setToBankName('');
    setToAccountHolder('');
    setToAccountNumber('');
    setToRoutingNumber('');
    setErpConfigId(invoice.erp_config?.id ?? '');
    setMemo(defaultMemo(invoice));
    setConfirmStep(false);
    setExecuting(false);
  }, [open, invoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── data fetching ───────────────────────────────────────────────
  const { data: wallets } = useWallets();
  const isCrypto = invoice ? isCryptoInvoice(invoice) : false;
  const token = invoice ? resolveToken(invoice) : '';

  const selectedWallet = wallets?.find((w: Wallet) => w.id === walletId);
  const balance = useWalletTokenBalance(walletId || undefined, token || undefined);

  const { data: bankAccounts } = useQuery<BankAccount[]>({
    queryKey: ['bank-accounts'],
    queryFn: fetchBankAccounts,
    enabled: open && !isCrypto,
  });

  const { data: erpConfigs } = useQuery<ErpConfiguration[]>({
    queryKey: ['erp-configs'],
    queryFn: fetchErpConfigs,
    enabled: open,
  });

  const selectedBank = bankAccounts?.find((b) => b.id === bankAccountId);

  // ── derived ─────────────────────────────────────────────────────
  if (!invoice) return null;

  const amount = invoice.amount;
  const currency = invoice.currency;
  const vendorDisplay = invoice.vendor?.name ?? invoice.vendor_name ?? '—';
  const hasDestination = isCrypto ? !!destinationAddress : !!(toBankName && toAccountHolder && toAccountNumber && toRoutingNumber);
  const hasSource = isCrypto ? !!walletId : !!bankAccountId;
  const canProceed = hasSource && hasDestination;

  const sourceLabel = isCrypto
    ? (selectedWallet?.label ?? selectedWallet?.address ?? 'wallet')
    : (selectedBank?.nickname ?? selectedBank?.institution_name ?? 'bank account');

  const destLabel = isCrypto
    ? (destinationAddress.length > 12
      ? `${destinationAddress.slice(0, 6)}...${destinationAddress.slice(-6)}`
      : destinationAddress)
    : toBankName || 'bank';

  // ── execute payment ─────────────────────────────────────────────
  const handleConfirm = async () => {
    setExecuting(true);
    try {
      if (isCrypto) {
        const res = await fetch('/api/transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromWalletId: walletId,
            toAddress: destinationAddress,
            chain: selectedWallet?.chain,
            token: resolveToken(invoice),
            amount: invoice.amount,
            memo,
            invoiceId: invoice.id,
            erpConfigId: erpConfigId || undefined,
          }),
        });
        if (!res.ok) {
          const { error } = await res.json();
          throw new Error(error ?? 'Transfer failed');
        }
        toast({ title: 'Payment sent', variant: 'success' });
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
        queryClient.invalidateQueries({ queryKey: ['transfers'] });
      } else {
        const res = await fetch('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromBankAccountId: bankAccountId,
            toBankName,
            toAccountNumber,
            toRoutingNumber,
            toAccountHolder,
            amount: invoice.amount,
            currency: invoice.currency,
            memo,
            invoiceId: invoice.id,
          }),
        });
        if (!res.ok) {
          const { error } = await res.json();
          throw new Error(error ?? 'Payment failed');
        }
        toast({
          title: 'Payment sent',
          description: 'Settlement typically takes 2 business days.',
          variant: 'success',
        });
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
        queryClient.invalidateQueries({ queryKey: ['fiat-payments'] });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Payment failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
      setExecuting(false);
    }
  };

  // ── render ──────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay Invoice &mdash; {invoice.invoice_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* ── Invoice summary ───────────────────────────────── */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice</span>
              <span className="font-medium">{invoice.invoice_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vendor</span>
              <span>{vendorDisplay}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-medium">{formatCurrency(amount)} {currency}</span>
            </div>
            {invoice.due_date && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Due</span>
                <span>{formatDate(invoice.due_date)}</span>
              </div>
            )}
          </div>

          {/* ── Funding source ────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>{isCrypto ? 'Source Wallet' : 'Source Bank Account'}</Label>
            {isCrypto ? (
              <>
                <Select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                  <option value="">Select wallet…</option>
                  {wallets?.map((w: Wallet) => (
                    <option key={w.id} value={w.id}>
                      {w.label ?? w.address} ({w.chain})
                    </option>
                  ))}
                </Select>
                {walletId && (
                  <BalanceHint
                    balance={balance}
                    token={token}
                    currentAmount={amount}
                  />
                )}
              </>
            ) : (
              <>
                <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                  <option value="">Select bank account…</option>
                  {bankAccounts?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nickname ?? b.institution_name} {b.last4 ? `(••${b.last4})` : ''}
                    </option>
                  ))}
                </Select>
                {bankAccountId && selectedBank?.current_balance != null && (
                  <FiatBalanceHint
                    balance={parseFloat(selectedBank.current_balance)}
                    currency={selectedBank.balance_currency ?? 'USD'}
                    currentAmount={amount}
                  />
                )}
              </>
            )}
          </div>

          {/* ── Destination ───────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>Destination</Label>
            {isCrypto ? (
              destinationAddress && resolveDestination(invoice) ? (
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm font-mono text-muted-foreground break-all">
                  {destinationAddress}
                </div>
              ) : (
                <Input
                  placeholder="Wallet address"
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                />
              )
            ) : resolveDestination(invoice) ? (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                {resolveDestination(invoice)}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Bank Name</Label>
                  <Input
                    value={toBankName}
                    onChange={(e) => setToBankName(e.target.value)}
                    placeholder="Recipient bank"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Account Holder</Label>
                  <Input
                    value={toAccountHolder}
                    onChange={(e) => setToAccountHolder(e.target.value)}
                    placeholder="Name on account"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Account Number</Label>
                    <Input
                      value={toAccountNumber}
                      onChange={(e) => setToAccountNumber(e.target.value)}
                      placeholder="Account #"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Routing Number</Label>
                    <Input
                      value={toRoutingNumber}
                      onChange={(e) => setToRoutingNumber(e.target.value)}
                      placeholder="Routing #"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── ERP recording ─────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>ERP Recording</Label>
            <Select value={erpConfigId} onChange={(e) => setErpConfigId(e.target.value)}>
              <option value="">None</option>
              {erpConfigs?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.provider})
                </option>
              ))}
            </Select>
          </div>

          {/* ── Memo ──────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>Memo</Label>
            <Input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Payment memo"
            />
          </div>
        </div>

        {/* ── Footer / two-step confirm ───────────────────────── */}
        <DialogFooter className="gap-2">
          {!confirmStep ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!canProceed} onClick={() => setConfirmStep(true)}>
                Pay {formatCurrency(amount)} {currency}
              </Button>
            </>
          ) : (
            <div className="w-full space-y-3">
              <p className="text-sm text-muted-foreground">
                This will send <span className="font-medium text-foreground">{formatCurrency(amount)} {currency}</span>{' '}
                from <span className="font-medium text-foreground">{sourceLabel}</span>{' '}
                to <span className="font-medium text-foreground">{destLabel}</span>.
                This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirmStep(false)}
                  disabled={executing}
                >
                  Go Back
                </Button>
                <Button onClick={handleConfirm} disabled={executing}>
                  {executing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Confirm Payment
                </Button>
              </div>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
