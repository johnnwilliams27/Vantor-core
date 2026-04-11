'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, Building2 } from 'lucide-react';

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Send Payment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center">
            <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-base font-semibold mb-2">Coming soon</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              Bank-to-bank payments are being rewired through a new payment
              provider to support real ACH, wire, and international rails.
              We&apos;ll open this back up once the integration is complete.
            </p>
            <p className="text-xs text-muted-foreground mt-4 max-w-md mx-auto">
              In the meantime, you can still view balances from your connected
              bank accounts and use on-chain transfers from your wallets.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
