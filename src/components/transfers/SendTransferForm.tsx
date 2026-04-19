'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { InlineSuccess } from '@/components/ui/inline-success';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useWallets } from '@/hooks/useWallets';
import { useWalletTokenBalance, useWalletTokenHoldings, formatWalletTokensLabel } from '@/hooks/useBalances';
import { BalanceHint } from '@/components/ui/balance-hint';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Send, CircleAlert, ChevronDown } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useInvoices } from '@/hooks/useInvoices';
import { formatCurrency, sanitizeErrorMessage } from '@/lib/utils';
import { VANTOR_FEE_RATE } from '@/lib/billing/tiers';
import { useOnChainTransfer, type TransferStep } from '@/hooks/useOnChainTransfer';
import { useSolanaTransfer, type SolanaTransferStep } from '@/hooks/useSolanaTransfer';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ErpConfiguration } from '@/types/database';

const schema = z.object({
  fromWalletId: z.string().uuid('Select a wallet'),
  toAddress: z.string().min(10, 'Enter a valid address'),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  memo: z.string().optional(),
  erpConfigId: z.string().optional(),
  invoiceId: z.string().uuid().optional(),
});

type FormData = z.infer<typeof schema>;

const EVM_STEP_LABELS: Record<TransferStep, string> = {
  idle: 'Send Transfer',
  signing: 'Sign in wallet…',
  confirming: 'Confirming on-chain…',
  recording: 'Finalizing…',
  done: 'Sent',
  error: 'Try again',
};

const SOL_STEP_LABELS: Record<SolanaTransferStep, string> = {
  idle: 'Send Transfer',
  checking: 'Checking recipient…',
  needs_ata_confirmation: 'Waiting for confirmation…',
  building: 'Preparing transaction…',
  signing: 'Sign in wallet…',
  confirming: 'Confirming on-chain…',
  recording: 'Finalizing…',
  done: 'Sent',
  error: 'Try again',
};

export function SendTransferForm() {
  const { data: wallets } = useWallets();
  const walletHoldings = useWalletTokenHoldings();
  const { data: unpaidInvoices } = useInvoices('unpaid');
  const { data: erpConfigs } = useQuery<ErpConfiguration[]>({
    queryKey: ['erp-configs'],
    queryFn: async () => {
      const res = await fetch('/api/erp/connect');
      if (!res.ok) return [];
      const { data } = await res.json();
      return (data ?? []).filter((c: ErpConfiguration) => c.is_active);
    },
    staleTime: 60_000,
  });
  const { toast } = useToast();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const evmTransfer = useOnChainTransfer();
  const solTransfer = useSolanaTransfer();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const selectedWalletId = watch('fromWalletId');
  const selectedToken = watch('token');
  const amount = watch('amount');
  const memo = watch('memo');
  const selectedWallet = wallets?.find((w) => w.id === selectedWalletId);
  const balance = useWalletTokenBalance(selectedWalletId, selectedToken);
  const exceeds = balance !== null && amount ? parseFloat(amount) > balance : false;

  const isEvmWallet = selectedWallet?.chain === 'ethereum';
  const activeStep = isEvmWallet ? evmTransfer.step : solTransfer.step;
  const isProcessing = activeStep !== 'idle' && activeStep !== 'done' && activeStep !== 'error';
  const stepLabel = isEvmWallet
    ? EVM_STEP_LABELS[evmTransfer.step]
    : SOL_STEP_LABELS[solTransfer.step];

  const onSubmit = async (data: FormData) => {
    if (exceeds) {
      toast({
        title: 'Insufficient balance',
        description: `You don't have enough ${data.token} in this wallet.`,
        variant: 'destructive',
      });
      return;
    }
    if (!selectedWallet) return;

    // Reset any previous state so UI doesn't show stale step labels
    evmTransfer.reset();
    solTransfer.reset();

    // Step 1: create a pending transfer row on the server
    let transferId: string;
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          chain: selectedWallet.chain,
          invoiceId: data.invoiceId || undefined,
          erpConfigId: data.erpConfigId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to create transfer');
      transferId = json.data.id;
    } catch (err) {
      toast({
        title: 'Transfer failed',
        description: sanitizeErrorMessage((err as Error).message),
        variant: 'destructive',
      });
      return;
    }

    // Step 2: drive client-side execution via the user's connected wallet
    if (selectedWallet.chain === 'ethereum') {
      await evmTransfer.execute({
        transferId,
        token: data.token,
        amount: data.amount,
        toAddress: data.toAddress,
        fromAddress: selectedWallet.address as `0x${string}`,
      });
    } else {
      await solTransfer.execute({
        transferId,
        token: data.token,
        amount: data.amount,
        toAddress: data.toAddress,
      });
    }

    // If the hook reached 'done', reset the form. 'error' leaves the form for retry.
    if (
      (selectedWallet.chain === 'ethereum' && evmTransfer.step === 'done') ||
      (selectedWallet.chain === 'solana' && solTransfer.step === 'done')
    ) {
      reset();
      setSuccessMessage('Transfer sent');
    }
  };

  return (
    <Card className="border-t-2 border-t-teal-500/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Send Transfer
          <InfoTooltip content="Send stablecoins (USDC/USDT) from your wallet to another wallet address. You'll sign the transaction directly in your connected wallet." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {successMessage && (
          <InlineSuccess message={successMessage} onDismiss={() => setSuccessMessage(null)} />
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>From Wallet</Label>
            <Select {...register('fromWalletId')} aria-required="true">
              <option value="">Select wallet…</option>
              {wallets?.map((w) => {
                const chain = w.chain.charAt(0).toUpperCase() + w.chain.slice(1);
                const base = w.label
                  ? `${w.label} · ${chain} (${w.address.slice(0, 6)}…${w.address.slice(-4)})`
                  : `${chain} · ${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
                const holdings = walletHoldings.get(w.id);
                const label = formatWalletTokensLabel(holdings);
                const suffix = label ? ` · ${label}` : '';
                return (
                  <option key={w.id} value={w.id}>
                    {base}{suffix}
                  </option>
                );
              })}
            </Select>
            {errors.fromWalletId && (
              <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors.fromWalletId.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Token</Label>
            <Select {...register('token')}>
              <option value="USDC">USDC</option>
              <option value="USDT">USDT</option>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>To Address</Label>
            <Input placeholder="0x… or base58…" {...register('toAddress')} />
            {errors.toAddress && (
              <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors.toAddress.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Amount</Label>
            <Input placeholder="100.00" {...register('amount')} aria-required="true" />
            <BalanceHint
              balance={balance}
              token={selectedToken ?? 'USDC'}
              currentAmount={amount}
              onMax={(max) => setValue('amount', max)}
            />
            {errors.amount && (
              <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors.amount.message}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white/70 transition-colors"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
            Advanced options
          </button>

          {showAdvanced && (
            <div className="space-y-4 pt-1">
              {erpConfigs && erpConfigs.length > 0 && (
                <div className="space-y-2">
                  <Label>ERP System <span className="text-gray-400">(optional)</span></Label>
                  <Select {...register('erpConfigId')}>
                    <option value="">None</option>
                    {erpConfigs.map((cfg) => (
                      <option key={cfg.id} value={cfg.id}>
                        {cfg.label} ({cfg.provider.toUpperCase()})
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              {unpaidInvoices && unpaidInvoices.filter((inv) => ['USDC', 'USDT'].includes(inv.currency ?? inv.token ?? '')).length > 0 && (
                <div className="space-y-2">
                  <Label>Apply to Invoice <span className="text-muted-foreground">(optional)</span></Label>
                  <Select {...register('invoiceId')}>
                    <option value="">None</option>
                    {unpaidInvoices
                      .filter((inv) => ['USDC', 'USDT'].includes(inv.currency ?? inv.token ?? ''))
                      .map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoice_number} — {inv.vendor_name ?? 'Unknown'} ({formatCurrency(inv.amount)} {inv.currency ?? inv.token})
                        </option>
                      ))}
                  </Select>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Memo (optional)</Label>
            <Input placeholder="Transfer reference…" {...register('memo')} />
            {memo && memo.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{memo.length}/2,000</p>
            )}
          </div>

          {amount && parseFloat(amount) > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-mono">{parseFloat(amount).toFixed(2)} {selectedToken ?? 'USDC'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vantor fee (0.25%)</span>
                <span className="font-mono">${(parseFloat(amount) * VANTOR_FEE_RATE).toFixed(2)}</span>
              </div>
              <div className="text-xs text-muted-foreground pt-1 border-t border-border/50">
                Vantor fees are aggregated and billed monthly to your card on file.
              </div>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isProcessing || exceeds || !selectedWalletId || !watch('toAddress') || !amount}
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {stepLabel}
              </>
            ) : (
              stepLabel || 'Send Transfer'
            )}
          </Button>

          {activeStep !== 'idle' && activeStep !== 'done' && activeStep !== 'error' && (
            <div className="flex items-center justify-center gap-1.5 mt-2">
              {(isEvmWallet
                ? ['signing', 'confirming', 'recording']
                : ['checking', 'building', 'signing', 'confirming', 'recording']
              ).map((step, i, arr) => {
                const activeIdx = arr.indexOf(activeStep);
                return (
                  <div
                    key={step}
                    className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${
                      i < activeIdx ? 'w-1.5 bg-teal-500' :
                      i === activeIdx ? 'w-4 bg-teal-400' :
                      'w-1.5 bg-white/10'
                    }`}
                  />
                );
              })}
            </div>
          )}
        </form>
      </CardContent>

      <ConfirmDialog
        open={!!solTransfer.pendingAtaConfirmation}
        onOpenChange={(open) => {
          if (!open) solTransfer.cancelAta();
        }}
        title={`Recipient needs a ${solTransfer.pendingAtaConfirmation?.token ?? ''} account`}
        description={
          `The recipient has never received ${solTransfer.pendingAtaConfirmation?.token ?? 'this token'} on Solana, so we need to create a token account for them. ` +
          `This is a one-time Solana rent fee of ~${(solTransfer.pendingAtaConfirmation?.rentSol ?? 0).toFixed(6)} SOL (≈$${((solTransfer.pendingAtaConfirmation?.rentSol ?? 0) * 150).toFixed(2)}) ` +
          `paid from your wallet in addition to normal network fees. Continue?`
        }
        confirmLabel="Continue & Sign"
        cancelLabel="Cancel"
        variant="primary"
        onConfirm={() => solTransfer.confirmAta()}
      />
    </Card>
  );
}
