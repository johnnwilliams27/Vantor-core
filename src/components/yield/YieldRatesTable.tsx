'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CardSpinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ArrowUpRight, ArrowLeft, Shield, Lock, Loader2, CheckCircle2, X, Info } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useYieldProtocols, useYieldDeposit, useSlippageCheck } from '@/hooks/useYield';
import { useOnChainDeposit, type DepositStep } from '@/hooks/useOnChainDeposit';
import { useSolanaDeposit, type SolanaDepositStep } from '@/hooks/useSolanaDeposit';
import { PROTOCOL_ADDRESSES } from '@/lib/yield/contracts/addresses';
import { SlippageWarning } from './SlippageWarning';
import type { SlippageEstimate } from '@/lib/yield/slippage';
import { useWallets } from '@/hooks/useWallets';
import { useWalletTokenBalance } from '@/hooks/useBalances';
import { BalanceHint } from '@/components/ui/balance-hint';
import { useToast } from '@/components/ui/toast';
import { RISK_FACTOR_LABELS, RISK_SCORE_LABELS } from '@/lib/yield/interface';
import type { RiskFactors } from '@/lib/yield/interface';
import type { YieldProtocolWithRates } from '@/hooks/useYield';
import { UpgradeGate } from '@/components/ui/upgrade-gate';

const COMING_SOON_PROTOCOLS = new Set(['sky', 'ethena', 'ondo', 'drift']);

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
};

const PROTOCOL_LOGOS: Record<string, string> = {
  aave_v3: '/partners/Aave_idWRQ7YLO7_0.svg',
  morpho_reservoir: '/partners/morpho-white.svg',
  morpho_steakhouse: '/partners/morpho-white.svg',
  kamino: '/partners/kamino-logo.svg',
  kamino_multiply: '/partners/kamino-logo.svg',
  ondo: '/partners/Ondo_Logo_0.svg',
  sky: '/partners/sky_logo.png',
  ethena: '/partners/ethena_logo.png',
  drift: '/partners/drift_logo.svg',
  compound_v3: '/partners/compound-white.png',
};

/**
 * Attribution for where each protocol's APY data is sourced from.
 * Shown below the rates table on each protocol card.
 */
const PROTOCOL_RATE_SOURCE: Record<string, string> = {
  aave_v3: 'On-chain: Aave V3 Pool.getReserveData()',
  compound_v3: 'On-chain: Compound V3 Comet.getSupplyRate()',
  morpho_steakhouse: 'Morpho Blue API (blue-api.morpho.org)',
  morpho_reservoir: 'Morpho Blue API (blue-api.morpho.org)',
  sky: 'On-chain: sUSDS.ssr() (Sky Savings Rate)',
  ethena: 'Ethena API (ethena.fi)',
  ondo: 'Ondo Finance (fixed rate)',
  kamino: 'Kamino API (api.kamino.finance)',
  kamino_multiply: 'Kamino API (api.kamino.finance)',
  drift: 'Drift API (drift.trade)',
};

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-red-100 text-red-800',
};

const SCORE_BAR_COLORS: Record<number, string> = {
  1: 'bg-green-500',
  2: 'bg-yellow-500',
  3: 'bg-red-500',
};

const SCORE_TEXT_COLORS: Record<number, string> = {
  1: 'text-green-700',
  2: 'text-yellow-700',
  3: 'text-red-700',
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatAPY(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Human-readable USD amount: $12.3B, $182M, $4.5K, $0.
 * Falls through to a "—" string when the value is nullish so callers
 * don't have to branch before passing in.
 */
function formatUsdCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

/* ---- Ondo KYC Modal ---- */

interface OndoKycModalProps {
  walletAddress: string;
  onVerified: () => void;
  onClose: () => void;
}

function OndoKycModal({ walletAddress, onVerified, onClose }: OndoKycModalProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ verified: boolean; message?: string } | null>(null);

  const handleVerify = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/yield/ondo/verify-kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      const data = await res.json();
      setResult(data);
      if (data.verified) {
        setTimeout(() => {
          onVerified();
        }, 1200);
      }
    } catch {
      setResult({ verified: false, message: 'Verification request failed.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0a1628] border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Image src="/partners/Ondo_Logo_0.svg" alt="Ondo" width={56} height={28} className="h-7 w-auto object-contain" unoptimized />
            <h3 className="text-white font-semibold">Identity Verification Required</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-gray-400 mb-4">
          Ondo requires separate identity verification before you can deposit. Complete KYC on
          Ondo&apos;s website, then return here to confirm.
        </p>

        <a
          href="https://ondo.finance"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-teal-400 hover:text-teal-300 underline underline-offset-2 mb-5 block"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Go to ondo.finance to complete KYC
        </a>

        {result && (
          <div className={`rounded-lg p-3 text-sm mb-4 ${
            result.verified
              ? 'bg-green-900/20 border border-green-800 text-green-300'
              : 'bg-red-900/20 border border-red-800 text-red-300'
          }`}>
            {result.verified
              ? 'KYC verified! You can now deposit.'
              : (result.message ?? 'Verification pending. Please complete KYC on ondo.finance first.')}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleVerify}
            disabled={loading || result?.verified === true}
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Checking…</>
            ) : (
              "I've completed Ondo KYC"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

const RISK_FACTOR_TOOLTIPS: Record<keyof RiskFactors, string> = {
  smartContract: 'Evaluates audit history and battle-testedness.\n1. Audited and battle-tested.\n2. Audited but newer.\n3. Unaudited or minimal review.',
  counterparty: 'Measures centralization risk.\n1. Fully decentralized.\n2. Partial custodian or multisig.\n3. Centralized with single point of failure.',
  liquidity: 'Assesses how easily you can enter/exit.\n1. Deep liquidity with instant withdrawal.\n2. Moderate with some delay.\n3. Thin liquidity or lock-up periods.',
  regulatory: 'Considers compliance posture.\n1. Regulated and compliant.\n2. Partially regulated.\n3. Unregulated or in a legal gray area.',
};

const RISK_SCORE_TOOLTIPS: Record<number, string> = {
  1: 'Low risk — the safest rating for this factor.',
  2: 'Medium risk — acceptable but warrants monitoring.',
  3: 'High risk — exercise caution and size positions conservatively.',
};

function RiskMeter({ factors }: { factors: RiskFactors }) {
  const avg = (factors.smartContract + factors.counterparty + factors.liquidity + factors.regulatory) / 4;
  const total = factors.smartContract + factors.counterparty + factors.liquidity + factors.regulatory;
  const pct = ((total - 4) / 8) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              avg <= 1.5 ? 'bg-green-500' : avg <= 2.25 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${Math.max(pct, 8)}%` }}
          />
        </div>
        <span className={`text-xs font-medium ${
          avg <= 1.5 ? 'text-green-700' : avg <= 2.25 ? 'text-yellow-700' : 'text-red-700'
        }`}>
          {avg.toFixed(1)}/3
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {(Object.entries(factors) as [keyof RiskFactors, number][]).map(([key, score]) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              {RISK_FACTOR_LABELS[key]}
              <InfoTooltip content={RISK_FACTOR_TOOLTIPS[key]} />
            </span>
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-3 rounded-sm ${
                      i <= score ? SCORE_BAR_COLORS[score] : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
              <span className={`text-[10px] font-medium ${SCORE_TEXT_COLORS[score]}`}>
                {RISK_SCORE_LABELS[score]}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Inline deposit form (card back) ---- */

function InlineDepositForm({
  protocol,
  onBack,
}: {
  protocol: YieldProtocolWithRates;
  onBack: () => void;
}) {
  const { data: wallets, isLoading: walletsLoading } = useWallets();
  const deposit = useYieldDeposit();
  const onChainDeposit = useOnChainDeposit();
  const solanaDeposit = useSolanaDeposit();
  const isSolanaProtocol = protocol.chain === 'solana';
  const slippageCheck = useSlippageCheck();
  const { toast } = useToast();
  const [token, setToken] = useState<string>(protocol.supportedTokens[0] ?? 'USDC');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [success, setSuccess] = useState<{ amount: string; token: string; apy: string } | null>(null);
  const [slippageEstimate, setSlippageEstimate] = useState<SlippageEstimate | null>(null);

  const chainWallets = wallets?.filter((w) => w.chain === protocol.chain) ?? [];
  const selectedWallet = chainWallets.find((w) => w.id === walletId);
  const selectedRate = protocol.rates.find((r) => r.token === token);
  const balance = useWalletTokenBalance(walletId || undefined, token || undefined);
  const exceeds = balance !== null && amount ? parseFloat(amount) > balance : false;
  const isOnChainProtocol = !!PROTOCOL_ADDRESSES[protocol.id as keyof typeof PROTOCOL_ADDRESSES];

  const stepLabels: Record<DepositStep, string> = {
    idle: 'Deposit',
    checking: 'Checking allowance...',
    approving: 'Approve in wallet...',
    approved: 'Approved',
    depositing: 'Sign in wallet...',
    confirming: 'Confirming on-chain...',
    done: 'Confirmed!',
    error: 'Try again',
  };
  const isProcessing = !['idle', 'done', 'error'].includes(onChainDeposit.step);

  const solanaStepLabels: Record<SolanaDepositStep, string> = {
    idle: 'Deposit', building: 'Building transaction...', signing: 'Sign in wallet...', confirming: 'Confirming on Solana...', recording: 'Recording...', done: 'Confirmed!', error: 'Try again',
  };
  const isSolanaProcessing = !['idle', 'done', 'error'].includes(solanaDeposit.step);

  const executeDeposit = async () => {
    if (!amount || !selectedWallet) return;

    if (isSolanaProtocol) {
      await solanaDeposit.execute({
        protocol: protocol.id as any,
        token,
        amount,
        walletAddress: selectedWallet.address,
        chain: 'solana',
      });
      if (solanaDeposit.step === 'done') {
        setSlippageEstimate(null);
        setSuccess({ amount, token, apy: selectedRate ? formatAPY(selectedRate.totalAPY) : '—' });
      }
      return;
    }

    if (isOnChainProtocol && protocol.chain === 'ethereum') {
      await onChainDeposit.execute({
        protocol: protocol.id as Parameters<typeof onChainDeposit.execute>[0]['protocol'],
        token,
        amount,
        walletAddress: selectedWallet.address as `0x${string}`,
        chain: protocol.chain,
      });
      if (onChainDeposit.step === 'done') {
        setSlippageEstimate(null);
        setSuccess({
          amount,
          token,
          apy: selectedRate ? formatAPY(selectedRate.totalAPY) : '—',
        });
      }
    } else {
      try {
        await deposit.mutateAsync({
          protocol: protocol.id,
          token,
          amount,
          walletAddress: selectedWallet.address,
          chain: protocol.chain,
        });
        setSlippageEstimate(null);
        setSuccess({
          amount,
          token,
          apy: selectedRate ? formatAPY(selectedRate.totalAPY) : '—',
        });
      } catch (err) {
        toast({
          title: 'Deposit failed',
          description: (err as Error).message,
          variant: 'destructive',
        });
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !selectedWallet) return;
    if (exceeds) {
      toast({ title: 'Insufficient balance', description: `You don't have enough ${token} in this wallet.`, variant: 'destructive' });
      return;
    }

    // Run slippage check first
    try {
      const estimate = await slippageCheck.mutateAsync({
        protocol: protocol.id,
        token,
        chain: protocol.chain,
        amountUsd: parseFloat(amount), // stablecoins ≈ 1:1 USD
      });

      if (estimate.severity === 'green') {
        // Low slippage — proceed immediately
        await executeDeposit();
      } else {
        // Yellow or red — show warning for user acknowledgment
        setSlippageEstimate(estimate);
      }
    } catch (err) {
      toast({
        title: 'Slippage check failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  // Success confirmation view
  if (success) {
    return (
      <Card className="relative overflow-hidden">
        <CardContent className="p-6 flex flex-col items-center text-center space-y-3">
          <div className="rounded-full bg-green-100 p-3">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-lg">Deposit Successful</p>
            <p className="text-sm text-muted-foreground mt-1">
              {parseFloat(success.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} {success.token} deposited to {protocol.name}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 px-4 py-2 text-sm">
            Earning <span className="font-semibold text-green-600">{success.apy}</span> APY
          </div>
          <Button size="sm" variant="outline" onClick={onBack} className="mt-2">
            Back to Protocols
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-base">Deposit to {protocol.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">
              Wallet ({protocol.chain === 'solana' ? 'Solana' : 'Ethereum'})
            </label>
            <Select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              <option value="">Select wallet…</option>
              {chainWallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {`${w.label ? `${w.label} · ` : ''}${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                </option>
              ))}
            </Select>
            {walletsLoading && (
              <p className="text-[11px] text-muted-foreground mt-1">Loading wallets…</p>
            )}
            {!walletsLoading && chainWallets.length === 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                No {protocol.chain} wallets connected. Add one in Wallets first.
              </p>
            )}
          </div>

          {protocol.supportedTokens.length > 1 && (
            <div>
              <label className="text-xs font-medium mb-1 block">Token</label>
              <Select value={token} onChange={(e) => setToken(e.target.value)}>
                {protocol.supportedTokens.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <label className="text-xs font-medium mb-1 block">Amount</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="1,000.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <BalanceHint
              balance={balance}
              token={token}
              currentAmount={amount}
              onMax={(max) => setAmount(max)}
            />
          </div>

          {selectedRate && (
            <div className="rounded-lg bg-muted/50 p-2.5 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground text-xs">Est. APY</span>
                <span className="font-semibold text-green-600 text-xs">
                  {formatAPY(selectedRate.totalAPY)}
                </span>
              </div>
              {amount && parseFloat(amount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-xs">Est. Annual Yield</span>
                  <span className="font-medium text-xs">
                    ${(parseFloat(amount) * selectedRate.totalAPY).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {protocol.kycRequired && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-800 p-2.5 text-xs text-yellow-800 dark:text-yellow-200">
              KYC required. Verify your account with {protocol.name} before depositing.
            </div>
          )}

          {/* Slippage warning */}
          {slippageEstimate && (
            <SlippageWarning
              estimate={slippageEstimate}
              onConfirm={executeDeposit}
              onCancel={() => setSlippageEstimate(null)}
              isExecuting={deposit.isPending}
            />
          )}

          {onChainDeposit.error && (
            <p className="text-xs text-red-500 text-center">{onChainDeposit.error}</p>
          )}

          {solanaDeposit.error && (
            <p className="text-xs text-red-500 text-center">{solanaDeposit.error}</p>
          )}

          {!slippageEstimate && (
            <Button
              type="submit"
              className="w-full"
              size="sm"
              disabled={isProcessing || isSolanaProcessing || deposit.isPending || slippageCheck.isPending || !amount || !walletId || exceeds}
            >
              {slippageCheck.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking liquidity…
                </>
              ) : isSolanaProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {solanaStepLabels[solanaDeposit.step]}
                </>
              ) : isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {stepLabels[onChainDeposit.step]}
                </>
              ) : deposit.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing…
                </>
              ) : (
                `Deposit ${token}`
              )}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/* ---- Main grid ---- */

export function YieldRatesTable() {
  const { data: protocols, isLoading } = useYieldProtocols();
  const [depositId, setDepositId] = useState<string | null>(null);
  const [ondoKycModal, setOndoKycModal] = useState<{ walletAddress: string } | null>(null);
  const [ondoKycVerified, setOndoKycVerified] = useState(false);
  // Tick every 10s so the "X ago" label stays current
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const { data: wallets } = useWallets();

  if (isLoading) {
    return <CardSpinner />;
  }

  // Sort by best total APY (low → high)
  const sorted = [...(protocols ?? [])].sort((a, b) => {
    const bestA = Math.max(...a.rates.map((r) => r.totalAPY));
    const bestB = Math.max(...b.rates.map((r) => r.totalAPY));
    return bestA - bestB;
  });

  // Compute oldest fetchedAt across all rates for the global timestamp
  const allFetchedAts = sorted
    .flatMap((p) => p.rates)
    .map((r) => (r as unknown as { fetchedAt?: string }).fetchedAt)
    .filter(Boolean) as string[];
  const oldestFetchedAt = allFetchedAts.length > 0
    ? allFetchedAts.reduce((oldest, ts) => (ts < oldest ? ts : oldest))
    : null;

  const handleOndoDeposit = async (protocolId: string) => {
    if (protocolId !== 'ondo') {
      setDepositId(protocolId);
      return;
    }
    // Find first wallet to check KYC (use first available wallet as proxy)
    const firstWallet = wallets?.[0];
    if (!firstWallet) {
      setDepositId(protocolId);
      return;
    }
    try {
      const res = await fetch('/api/yield/ondo/kyc-status');
      const data = await res.json();
      const record = (data.data ?? []).find(
        (d: { wallet_address: string; status: string }) =>
          d.wallet_address.toLowerCase() === firstWallet.address.toLowerCase() &&
          d.status === 'verified'
      );
      if (record) {
        setOndoKycVerified(true);
        setDepositId(protocolId);
      } else {
        setOndoKycModal({ walletAddress: firstWallet.address });
      }
    } catch {
      // On error, fall through to deposit form
      setDepositId(protocolId);
    }
  };

  return (
    <div className="space-y-3">
      {/* Rate timestamp */}
      {oldestFetchedAt && (
        <p className="text-xs text-muted-foreground text-right">
          Last updated: {new Date(oldestFetchedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })} ({formatRelativeTime(oldestFetchedAt)})
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sorted.map((p) => {
          if (depositId === p.id) {
            return (
              <InlineDepositForm
                key={p.id}
                protocol={p}
                onBack={() => setDepositId(null)}
              />
            );
          }

          const comingSoon = COMING_SOON_PROTOCOLS.has(p.id);

          return (
            <Card key={p.id} className="relative overflow-hidden">
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                {PROTOCOL_LOGOS[p.id] ? (
                  <div className="flex items-center gap-2">
                    <div className="h-[38px] flex items-center">
                      <Image src={PROTOCOL_LOGOS[p.id]} alt={p.name} width={64} height={38} className="h-[38px] w-auto object-contain" unoptimized />
                    </div>
                    {comingSoon && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        Coming Soon
                      </span>
                    )}
                    {p.kycRequired && (
                      p.id === 'ondo' && ondoKycVerified ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          KYC Verified
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-yellow-500 border-yellow-500/30">
                          <Lock className="h-3 w-3 mr-1" />
                          KYC Required
                        </Badge>
                      )
                    )}
                  </div>
                ) : (
                  <span className="text-2xl font-bold text-muted-foreground">{p.name}</span>
                )}
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge variant={p.chain === 'ethereum' ? 'ethereum' : 'solana'}>{CHAIN_LABELS[p.chain] ?? p.chain}</Badge>
                  <Badge className={RISK_COLORS[p.riskLevel]}>
                    <Shield className="h-3 w-3 mr-1" />
                    {capitalize(p.riskLevel)} Risk
                  </Badge>
                </div>
              </div>
              <div className="px-5 pb-2 border-b border-border/50">
                <CardTitle className="text-base">{p.name}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
              </div>
              <CardContent className="space-y-3 pt-2">

                {/* Pool TVL — summed across tokens for the protocol. If no
                    rate has a TVL (e.g. fetcher hasn't populated it yet),
                    skip the whole strip instead of showing "$0". */}
                {(() => {
                  const tvls = p.rates
                    .map((r) => (r as unknown as { tvlUsd?: number | null }).tvlUsd)
                    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
                  if (tvls.length === 0) return null;
                  const totalTvl = tvls.reduce((a, b) => a + b, 0);
                  return (
                    <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          Pool TVL
                        </span>
                        <InfoTooltip content="Total Value Locked across all tokens supported by this protocol. Refreshed every minute from on-chain reads or the protocol's own API." />
                      </div>
                      <span className="text-lg font-bold tracking-tight">
                        {formatUsdCompact(totalTvl)}
                      </span>
                    </div>
                  );
                })()}

                {p.riskFactors && (
                  <div className="border rounded-md p-3 bg-muted/30">
                    <RiskMeter factors={p.riskFactors} />
                  </div>
                )}

                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium">Token</th>
                        <th className="text-right px-3 py-2 font-medium">Supply APY</th>
                        <th className="text-right px-3 py-2 font-medium">Rewards</th>
                        <th className="text-right px-3 py-2 font-medium">Total APY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.rates.map((r) => {
                        const rateWithMeta = r as unknown as { fetchedAt?: string; isStale?: boolean };
                        return (
                          <tr key={`${r.protocol}-${r.token}`} className="border-t">
                            <td className="px-3 py-2 font-medium">{r.token}</td>
                            <td className="text-right px-3 py-2">{formatAPY(r.supplyAPY)}</td>
                            <td className="text-right px-3 py-2 text-muted-foreground">
                              {r.rewardAPY > 0 ? `+${formatAPY(r.rewardAPY)}` : '—'}
                            </td>
                            <td className="text-right px-3 py-2">
                              <span className="font-semibold text-green-600">{formatAPY(r.totalAPY)}</span>
                              {rateWithMeta.isStale && (
                                <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-medium">
                                  Stale
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {(() => {
                  const latestFetch = p.rates
                    .map((r) => (r as unknown as { fetchedAt?: string }).fetchedAt)
                    .filter(Boolean)
                    .sort()
                    .pop();
                  const source = PROTOCOL_RATE_SOURCE[p.id];
                  return (
                    <div className="text-[10px] text-muted-foreground space-y-0.5">
                      {source && (
                        <p className="flex items-center gap-1">
                          <Info className="h-2.5 w-2.5 shrink-0" />
                          Rate source: {source}
                        </p>
                      )}
                      {latestFetch && (
                        <p>
                          Last updated: {new Date(latestFetch).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })} ({formatRelativeTime(latestFetch)})
                        </p>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center justify-end pt-1">
                  {comingSoon ? (
                    <button
                      type="button"
                      disabled
                      className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-muted/50 text-muted-foreground cursor-not-allowed border border-border"
                    >
                      Coming Soon
                    </button>
                  ) : (
                    <UpgradeGate feature="Deposit into Yield">
                      <Button size="sm" className="gap-1" onClick={() => handleOndoDeposit(p.id)}>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        Deposit
                      </Button>
                    </UpgradeGate>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Ondo KYC Modal */}
      {ondoKycModal && (
        <OndoKycModal
          walletAddress={ondoKycModal.walletAddress}
          onVerified={() => {
            setOndoKycVerified(true);
            setOndoKycModal(null);
            setDepositId('ondo');
          }}
          onClose={() => setOndoKycModal(null)}
        />
      )}
    </div>
  );
}
