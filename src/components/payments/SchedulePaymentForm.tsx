'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock } from 'lucide-react';

export function SchedulePaymentForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Schedule Payment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
          <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Coming soon</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Scheduled bank payments require unattended rail selection, which we&apos;re
            rolling out in a future release. For now, payments are submitted
            immediately using the payment rail you pick in the Send Payment form.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
