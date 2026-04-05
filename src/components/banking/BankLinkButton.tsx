'use client';
import { useState, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Building2, Loader2, Globe } from 'lucide-react';
import { ManualBankForm } from './ManualBankForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UpgradeGate } from '@/components/ui/upgrade-gate';

// Belvo Connect widget is loaded via CDN script injection
declare global {
  interface Window {
    belvoSDK?: {
      createWidget: (
        accessToken: string,
        callbacks: {
          onSuccess: (link: string, institution: string) => void;
          onExit: (data: unknown) => void;
          onEvent?: (data: unknown) => void;
        },
        options?: Record<string, unknown>,
      ) => { build: () => void };
    };
  }
}

function loadBelvoScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.belvoSDK) { resolve(); return; }
    const existing = document.getElementById('belvo-connect-script');
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const script = document.createElement('script');
    script.id = 'belvo-connect-script';
    script.src = 'https://cdn.belvo.io/belvo-connect.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Belvo Connect script'));
    document.head.appendChild(script);
  });
}

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface BankLinkButtonProps {
  onSuccess: () => void;
  bankingProvider: 'stripe_fc' | 'belvo' | null;
}

export function BankLinkButton({ onSuccess, bankingProvider }: BankLinkButtonProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const startStripeFC = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bank-accounts/stripe-fc/session', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe not loaded');

      const result = await stripe.collectFinancialConnectionsAccounts({
        clientSecret: json.data.clientSecret,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      const accountIds = result.financialConnectionsSession.accounts.map((a) => a.id);
      const linkRes = await fetch('/api/bank-accounts/stripe-fc/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds }),
      });
      if (!linkRes.ok) throw new Error('Failed to save accounts');

      toast({ title: 'Bank account connected', variant: 'success' });
      onSuccess();
    } catch (err) {
      toast({ title: 'Connection failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, onSuccess]);

  const startBelvo = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch a short-lived access token from our server
      const tokenRes = await fetch('/api/bank-accounts/belvo/widget-token', { method: 'POST' });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenJson.error || 'Failed to get widget token');
      const { accessToken } = tokenJson.data;

      // Inject Belvo CDN script on demand
      await loadBelvoScript();

      if (!window.belvoSDK) throw new Error('Belvo SDK failed to initialise');

      const widget = window.belvoSDK.createWidget(
        accessToken,
        {
          onSuccess: async (linkId: string, institution: string) => {
            try {
              const linkRes = await fetch('/api/bank-accounts/belvo/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ linkId, institution }),
              });
              const linkJson = await linkRes.json();
              if (!linkRes.ok) throw new Error(linkJson.error || 'Failed to save accounts');
              toast({ title: 'Bank account connected', variant: 'success' });
              onSuccess();
            } catch (err) {
              toast({ title: 'Connection failed', description: (err as Error).message, variant: 'destructive' });
            } finally {
              setLoading(false);
            }
          },
          onExit: () => {
            setLoading(false);
          },
        },
      );

      widget.build();
    } catch (err) {
      toast({ title: 'Connection failed', description: (err as Error).message, variant: 'destructive' });
      setLoading(false);
    }
  }, [toast, onSuccess]);

  if (!bankingProvider) {
    return (
      <UpgradeGate feature="Link Bank Account">
        <Button className="w-full" disabled>
          <Building2 className="mr-2 h-4 w-4" />
          Connect Bank Account
        </Button>
      </UpgradeGate>
    );
  }

  if (showManual) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Link Bank Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ManualBankForm onSuccess={onSuccess} />
        </CardContent>
      </Card>
    );
  }

  if (bankingProvider === 'stripe_fc') {
    return (
      <div className="space-y-3">
        <Button onClick={startStripeFC} disabled={loading} className="w-full">
          {loading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting…</>
          ) : (
            <><Building2 className="mr-2 h-4 w-4" />Connect Bank Account</>
          )}
        </Button>
        <Button variant="outline" className="w-full" onClick={() => setShowManual(true)}>
          Add Manually Instead
        </Button>
      </div>
    );
  }

  // Belvo flow
  return (
    <div className="space-y-3">
      <Button onClick={startBelvo} disabled={loading} className="w-full">
        {loading ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting…</>
        ) : (
          <><Globe className="mr-2 h-4 w-4" />Connect Bank via Belvo</>
        )}
      </Button>
      <Button variant="outline" className="w-full" onClick={() => setShowManual(true)}>
        Add Manually Instead
      </Button>
    </div>
  );
}
