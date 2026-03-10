'use client';
import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Building2, Loader2 } from 'lucide-react';
import { ManualBankForm } from './ManualBankForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Inner component — rendered only when we have a linkToken, so the hook is always called */
function PlaidOpener({
  linkToken,
  onSuccess,
  onExit,
}: {
  linkToken: string;
  onSuccess: (publicToken: string, accountId: string) => void;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken, metadata) => {
      const accountId = metadata.accounts[0]?.id ?? '';
      onSuccess(publicToken, accountId);
    },
    onExit,
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return (
    <Button disabled className="w-full">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Opening Plaid…
    </Button>
  );
}

interface PlaidLinkButtonProps {
  /** Called after a bank account is successfully connected (Plaid or manual) */
  onSuccess: () => void;
  /** Whether Plaid is configured server-side — pass from server component */
  plaidConfigured?: boolean;
}

export function PlaidLinkButton({ onSuccess, plaidConfigured = false }: PlaidLinkButtonProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [exchanging, setExchanging] = useState(false);

  const fetchLinkToken = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bank-accounts/plaid/link-token', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setLinkToken(json.data.linkToken);
    } catch (err) {
      toast({ title: 'Failed to start Plaid', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handlePlaidSuccess = useCallback(async (publicToken: string, accountId: string) => {
    setLinkToken(null);
    setExchanging(true);
    try {
      const res = await fetch('/api/bank-accounts/plaid/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken, accountId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Bank account connected', variant: 'success' });
      onSuccess();
    } catch (err) {
      toast({ title: 'Exchange failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setExchanging(false);
    }
  }, [toast, onSuccess]);

  // No Plaid configured → always show manual form
  if (!plaidConfigured || showManual) {
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

  if (linkToken) {
    return (
      <PlaidOpener
        linkToken={linkToken}
        onSuccess={handlePlaidSuccess}
        onExit={() => setLinkToken(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Button onClick={fetchLinkToken} disabled={loading || exchanging} className="w-full">
        {loading || exchanging ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{exchanging ? 'Saving…' : 'Connecting…'}</>
        ) : (
          <><Building2 className="mr-2 h-4 w-4" />Connect Bank via Plaid</>
        )}
      </Button>
      <Button variant="outline" className="w-full" onClick={() => setShowManual(true)}>
        Add Manually Instead
      </Button>
    </div>
  );
}
