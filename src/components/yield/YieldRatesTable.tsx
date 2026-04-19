'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CardSkeleton, CardError } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ArrowUpRight, ArrowLeft, Shield, Lock, Loader2, CheckCircle2, X, Info, Landmark, Clock } from 'lucide-react';
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
import {
  type VenueCategory,
  CATEGORY_LABELS,
  ELIGIBILITY_LABELS,
  isTokenizedMMF,
  getVenueLogoPath,
} from '@/lib/yield/venues';

const COMING_SOON_PROTOCOLS = new Set(['sky', 'ethena', 'ondo_usdy']);

const CATEGORY_FILTER_ORDER: Array<VenueCategory | 'all'> = [
  'all',
  'tokenized_mmf',
  'defi_vault',
  'defi_lending_market',
];

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
};

/**
 * Attribution for where each protocol's APY data is sourced from.
 * Shown below the rates table on each protocol card.
 */
const PROTOCOL_RATE_SOURCE: Record<string, string> = {
  aave_v3: 'On-chain: Aave V3 Pool.getReserveData() + aToken.totalSupply()',
  compound_v3: 'On-chain: Compound V3 Comet.getSupplyRate() + Comet.totalSupply()',
  morpho_steakhouse: 'Morpho Blue API (blue-api.morpho.org)',
  morpho_reservoir: 'Morpho Blue API (blue-api.morpho.org)',
  sky: 'On-chain: sUSDS.ssr() + sUSDS.totalAssets()',
  ethena: 'APY: ethena.fi · TVL: DefiLlama (yields.llama.fi)',
  ondo_usdy: 'Ondo Finance (fixed rate)',
  kamino: 'DefiLlama (yields.llama.fi) — kamino-lend pool',
  kamino_multiply: 'No live APY feed — Kamino does not publish Multiply vault APY',
  // Tokenized MMFs — reference yield from rwa.xyz, not a live fetch
  buidl:     'rwa.xyz reference (refreshed quarterly)',
  ousg:      'rwa.xyz reference (refreshed quarterly)',
  ustb:      'rwa.xyz reference (refreshed quarterly)',
  benji:     'rwa.xyz reference (refreshed quarterly)',
  usyc:      'rwa.xyz reference (refreshed quarterly)',
  spiko_usd: 'rwa.xyz reference (refreshed quarterly)',
};

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/8 text-green-400',
  medium: 'bg-amber-500/8 text-amber-400',
  high: 'bg-red-500/8 text-red-400',
};

const SCORE_BAR_COLORS: Record<number, string> = {
  1: 'bg-green-500',
  2: 'bg-amber-500',
  3: 'bg-red-500',
};

const SCORE_TEXT_COLORS: Record<number, string> = {
  1: 'text-green-400',
  2: 'text-amber-400',
  3: 'text-red-400',
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
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
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
      <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Image src="/partners/Ondo_Logo_0.svg" alt="Ondo" width={56} height={28} className="h-7 w-auto object-contain" unoptimized />
            <h3 className="text-white font-semibold">Identity Verification Required</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
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
            className={`h-full rounded-full transition-[width,background-color] ${
              avg <= 1.5 ? 'bg-green-500' : avg <= 2.25 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${Math.max(pct, 8)}%` }}
          />
        </div>
        <span className={`text-xs font-medium ${
          avg <= 1.5 ? 'text-green-400' : avg <= 2.25 ? 'text-amber-400' : 'text-red-400'
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
              <span className={`text-3xs font-medium ${SCORE_TEXT_COLORS[score]}`}>
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
          <div className="rounded-full bg-green-500/10 p-3">
            <CheckCircle2 className="h-8 w-8 text-green-400" />
          </div>
          <div>
            <p className="font-semibold text-lg">Deposit Successful</p>
            <p className="text-sm text-muted-foreground mt-1">
              {parseFloat(success.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} {success.token} deposited to {protocol.name}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 px-4 py-2 text-sm">
            Earning <span className="font-semibold text-green-400">{success.apy}</span> APY
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
              <p className="text-2xs text-muted-foreground mt-1">Loading wallets…</p>
            )}
            {!walletsLoading && chainWallets.length === 0 && (
              <p className="text-2xs text-muted-foreground mt-1">
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
                <span className="font-semibold text-green-400 text-xs">
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
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400">
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

/* ---- Category filter bar ---- */

function CategoryFilterBar({
  selected,
  onSelect,
  counts,
}: {
  selected: VenueCategory | 'all';
  onSelect: (c: VenueCategory | 'all') => void;
  counts: Record<VenueCategory | 'all', number>;
}) {
  const label = (c: VenueCategory | 'all') =>
    c === 'all' ? 'All' : CATEGORY_LABELS[c];

  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORY_FILTER_ORDER.map((c) => {
        const isActive = selected === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onSelect(c)}
            className={`
              inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium
              transition-colors border
              ${isActive
                ? 'bg-muted text-foreground border-border'
                : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground'}
            `}
          >
            {label(c)}
            <span className={`text-3xs rounded-full px-1.5 py-0.5 tabular-nums ${
              isActive ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {counts[c] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- Tokenized MMF card variant ---- */

function TokenizedMmfCard({ protocol }: { protocol: YieldProtocolWithRates }) {
  // Narrow: we know category === 'tokenized_mmf' by the time we render this.
  if (!isTokenizedMMF(protocol.venue)) return null;
  const venue = protocol.venue;

  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg font-semibold truncate">{venue.displayName}</span>
          <Badge variant="pending" className="ml-1 text-3xs">Coming Soon</Badge>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1">
            {venue.supportedChains
              .filter((c) => c.toLowerCase() === 'ethereum' || c.toLowerCase() === 'solana')
              .map((chain) => (
                <Badge key={chain} variant={chain.toLowerCase() === 'ethereum' ? 'ethereum' : 'solana'} className="text-3xs">
                  {chain}
                </Badge>
              ))}
          </div>
          <span className="text-2xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            USDC
          </span>
        </div>
      </div>

      <div className="px-5 pb-2 border-b border-border/50">
        <p className="text-xs text-muted-foreground">{venue.notes}</p>
      </div>

      <CardContent className="space-y-3 pt-3">
        {/* Reference yield — the hero metric for an MMF card */}
        <div className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Reference Yield
            </span>
            <InfoTooltip content={`7-day annualized yield as of ${venue.yieldAsOf}. Not a live quote — refreshed quarterly from rwa.xyz.`} />
          </div>
          <span className="text-sm font-bold tracking-tight text-foreground tabular-nums">
            {formatAPY(venue.referenceYield)}
          </span>
        </div>

        {/* Fund Size — deliberately NOT called "TVL" */}
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fund Size / AUM
            </span>
            <InfoTooltip content="Assets under management (AUM) of the underlying fund. Unlike a DeFi pool's TVL, this is informational — tokenized MMFs are backed by the underlying Treasury market and have effectively unlimited capacity." />
          </div>
          <span className="text-sm font-bold tracking-tight tabular-nums">
            {formatUsdCompact(venue.fundSizeUsd)}
          </span>
        </div>

        {/* Metadata grid — 3 rows × 2 columns */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider">Fund Manager</div>
            <div className="font-medium truncate">{venue.fundManager}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider">Eligibility</div>
            <div className="font-medium">{ELIGIBILITY_LABELS[venue.eligibility]}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider">Underlying</div>
            <div className="font-medium">{venue.underlyingComposition}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider">Reporting</div>
            <div className="font-medium">{venue.reportingCadence}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider">Redemption</div>
            <div className="font-medium flex items-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {venue.timeToCash}
            </div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground uppercase tracking-wider">Wrapper</div>
            <div className="font-medium">{venue.regulatoryWrapper}</div>
          </div>
        </div>

        {/* Rate source + as-of date */}
        <div className="text-2xs text-muted-foreground space-y-0.5">
          <p className="flex items-center gap-1">
            <Info className="h-2.5 w-2.5 shrink-0" />
            {PROTOCOL_RATE_SOURCE[venue.id] ?? 'rwa.xyz reference'}
          </p>
          <p className="pl-3.5">As of {venue.yieldAsOf}</p>
        </div>

        <p className="text-xs text-muted-foreground text-center pt-1">Coming soon</p>
      </CardContent>
    </Card>
  );
}

/* ---- Main grid ---- */

export function YieldRatesTable() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Category filter — reads from ?category= URL param, defaults to 'all'.
  const categoryParam = searchParams.get('category');
  const selectedCategory: VenueCategory | 'all' =
    categoryParam === 'tokenized_mmf' ||
    categoryParam === 'defi_vault' ||
    categoryParam === 'defi_lending_market'
      ? categoryParam
      : 'all';

  // Fetch the unfiltered list once — we need it for the count badges and
  // filter client-side so toggling categories is instant.
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

  const onSelectCategory = useCallback(
    (c: VenueCategory | 'all') => {
      const params = new URLSearchParams(searchParams.toString());
      if (c === 'all') {
        params.delete('category');
      } else {
        params.set('category', c);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  if (isLoading) {
    return <Card><CardContent className="py-5"><CardSkeleton rows={6} /></CardContent></Card>;
  }

  const allProtocols = protocols ?? [];

  // Category counts for the filter pill badges — computed on the unfiltered set.
  const counts: Record<VenueCategory | 'all', number> = {
    all: allProtocols.length,
    tokenized_mmf: 0,
    defi_vault: 0,
    defi_lending_market: 0,
  };
  for (const p of allProtocols) {
    counts[p.category] = (counts[p.category] ?? 0) + 1;
  }

  // Apply the category filter client-side.
  const filteredProtocols =
    selectedCategory === 'all'
      ? allProtocols
      : allProtocols.filter((p) => p.category === selectedCategory);

  // Sort: pinned protocols first (Spiko, Aave), then highest APY.
  const PINNED_ORDER: Record<string, number> = { spiko_usd: 0, aave_v3: 1, usyc: 2, compound_v3: 3, ethena: 998, kamino_multiply: 999 };
  const sorted = [...filteredProtocols].sort((a, b) => {
    const pinA = PINNED_ORDER[a.id] ?? 999;
    const pinB = PINNED_ORDER[b.id] ?? 999;
    if (pinA !== pinB) return pinA - pinB;
    const bestA = a.rates.length > 0 ? Math.max(...a.rates.map((r) => r.totalAPY)) : 0;
    const bestB = b.rates.length > 0 ? Math.max(...b.rates.map((r) => r.totalAPY)) : 0;
    return bestB - bestA;
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
    if (protocolId !== 'ondo_usdy') {
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
      {/* Category filter bar */}
      <CategoryFilterBar
        selected={selectedCategory}
        onSelect={onSelectCategory}
        counts={counts}
      />

      {sorted.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No venues match the <span className="font-medium">{selectedCategory === 'all' ? 'current filter' : CATEGORY_LABELS[selectedCategory]}</span> filter.
          </p>
        </div>
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

          // Tokenized MMFs get their own card layout — different hero
          // metric (reference yield + as-of), different secondary metric
          // (Fund Size, not TVL), and a richer metadata grid.
          if (p.category === 'tokenized_mmf') {
            return <TokenizedMmfCard key={p.id} protocol={p} />;
          }

          const comingSoon = COMING_SOON_PROTOCOLS.has(p.id);

          return (
            <Card key={p.id} className="relative overflow-hidden">
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg font-semibold truncate">{p.name}</span>
                  {comingSoon && (
                    <Badge variant="pending" className="text-3xs">Coming Soon</Badge>
                  )}
                  {p.kycRequired && (
                    p.id === 'ondo_usdy' && ondoKycVerified ? (
                      <Badge variant="active" className="text-3xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        KYC Verified
                      </Badge>
                    ) : (
                      <Badge variant="pending" className="text-3xs">
                        <Lock className="h-3 w-3 mr-1" />
                        KYC Required
                      </Badge>
                    )
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <div className="flex items-center gap-1">
                    <Badge variant={p.chain === 'ethereum' ? 'ethereum' : 'solana'} className="text-3xs">
                      {CHAIN_LABELS[p.chain] ?? p.chain}
                    </Badge>
                  </div>
                  {p.supportedTokens?.length > 0 && (
                    <div className="flex items-center gap-1">
                      {p.supportedTokens.map((t) => (
                        <span key={t} className="text-2xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="px-5 pb-2 border-b border-border/50">
                <p className="text-xs text-muted-foreground">{p.description}</p>
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
                    <div className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Pool TVL
                        </span>
                        <InfoTooltip content="Total Value Locked across all tokens supported by this protocol. Refreshed every minute from on-chain reads or the protocol's own API." />
                      </div>
                      <span className="text-sm font-bold tracking-tight text-foreground tabular-nums">
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
                              <span className="font-semibold text-green-400">{formatAPY(r.totalAPY)}</span>
                              {rateWithMeta.isStale && (
                                <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-500/10 text-amber-400 px-1.5 py-0.5 text-3xs font-medium">
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
                    <div className="text-2xs text-muted-foreground space-y-0.5">
                      {source && (
                        <p className="flex items-center gap-1">
                          <Info className="h-2.5 w-2.5 shrink-0" />
                          {source}
                        </p>
                      )}
                      {latestFetch && (
                        <p className="pl-3.5">Updated {formatRelativeTime(latestFetch)}</p>
                      )}
                    </div>
                  );
                })()}

                <div className="pt-2">
                  {comingSoon ? (
                    <p className="text-xs text-muted-foreground text-center">Coming soon</p>
                  ) : (
                    <UpgradeGate feature="Deposit into Yield">
                      <button
                        onClick={() => handleOndoDeposit(p.id)}
                        className="text-xs font-medium text-teal-500 hover:text-teal-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 rounded-sm"
                      >
                        Deposit →
                      </button>
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
            setDepositId('ondo_usdy');
          }}
          onClose={() => setOndoKycModal(null)}
        />
      )}
    </div>
  );
}
