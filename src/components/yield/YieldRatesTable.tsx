'use client';
import { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CardSpinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ArrowUpRight, ArrowLeft, Shield, Lock, Loader2, CheckCircle2 } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useYieldProtocols, useYieldDeposit, useSlippageCheck } from '@/hooks/useYield';
import { SlippageWarning } from './SlippageWarning';
import type { SlippageEstimate } from '@/lib/yield/slippage';
import { useWallets } from '@/hooks/useWallets';
import { useWalletTokenBalance } from '@/hooks/useBalances';
import { BalanceHint } from '@/components/ui/balance-hint';
import { useToast } from '@/components/ui/toast';
import { RISK_FACTOR_LABELS, RISK_SCORE_LABELS } from '@/lib/yield/interface';
import type { RiskFactors } from '@/lib/yield/interface';
import type { YieldProtocolWithRates } from '@/hooks/useYield';

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
};

const PROTOCOL_LOGOS: Record<string, string> = {
  aave_v3: '/partners/Aave_idWRQ7YLO7_0.svg',
  morpho: '/partners/morpho-white.svg',
  morpho_steakhouse: '/partners/morpho-white.svg',
  kamino: '/partners/kamino-logo.svg',
  kamino_multiply: '/partners/kamino-logo.svg',
  ondo: '/partners/Ondo_Logo_0.svg',
  sky: '/partners/sky_logo.png',
  ethena: '/partners/ethena_logo.png',
  maple: '/partners/maple_logo.svg',
  drift: '/partners/drift_logo.svg',
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

  const executeDeposit = async () => {
    if (!amount || !selectedWallet) return;
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

          {!slippageEstimate && (
            <Button
              type="submit"
              className="w-full"
              size="sm"
              disabled={deposit.isPending || slippageCheck.isPending || !amount || !walletId || exceeds}
            >
              {slippageCheck.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking liquidity…
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

  if (isLoading) {
    return <CardSpinner />;
  }

  // Sort by best total APY (low → high)
  const sorted = [...(protocols ?? [])].sort((a, b) => {
    const bestA = Math.max(...a.rates.map((r) => r.totalAPY));
    const bestB = Math.max(...b.rates.map((r) => r.totalAPY));
    return bestA - bestB;
  });

  return (
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

        return (
          <Card key={p.id} className="relative overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              {PROTOCOL_LOGOS[p.id] ? (
                <Image src={PROTOCOL_LOGOS[p.id]} alt={p.name} width={64} height={38} className="h-[38px] w-auto object-contain" unoptimized />
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
                    {p.rates.map((r) => (
                      <tr key={`${r.protocol}-${r.token}`} className="border-t">
                        <td className="px-3 py-2 font-medium">{r.token}</td>
                        <td className="text-right px-3 py-2">{formatAPY(r.supplyAPY)}</td>
                        <td className="text-right px-3 py-2 text-muted-foreground">
                          {r.rewardAPY > 0 ? `+${formatAPY(r.rewardAPY)}` : '—'}
                        </td>
                        <td className="text-right px-3 py-2 font-semibold text-green-600">
                          {formatAPY(r.totalAPY)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {p.kycRequired && (
                    <>
                      <Lock className="h-3 w-3" />
                      KYC Required
                    </>
                  )}
                </div>
                <Button size="sm" className="gap-1" onClick={() => setDepositId(p.id)}>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Deposit
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
