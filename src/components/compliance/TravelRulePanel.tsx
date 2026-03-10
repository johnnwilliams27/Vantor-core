'use client';
import { useTravelRuleTransfers } from '@/hooks/useCompliance';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  received: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export function TravelRulePanel() {
  const { data: transfers, isLoading } = useTravelRuleTransfers();

  return (
    <div className="rounded-lg border bg-card">
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold">Travel Rule Transfers</h3>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
      ) : !transfers?.length ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No travel rule transfers yet. Transfers above the threshold will automatically appear here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Direction</th>
                <th className="px-4 py-2 font-medium">Amount (USD)</th>
                <th className="px-4 py-2 font-medium">Originator</th>
                <th className="px-4 py-2 font-medium">Beneficiary</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2 capitalize">{t.direction}</td>
                  <td className="px-4 py-2 font-medium">${Number(t.amount_usd).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <div>{t.originator_name ?? '-'}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {t.originator_wallet.slice(0, 8)}...{t.originator_wallet.slice(-4)}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div>{t.beneficiary_name ?? '-'}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {t.beneficiary_wallet.slice(0, 8)}...{t.beneficiary_wallet.slice(-4)}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? ''}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(t.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
