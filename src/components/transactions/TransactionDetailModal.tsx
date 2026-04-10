'use client';

import { X } from 'lucide-react';

interface TransactionDetail {
  id: string;
  type: 'ramp' | 'swap' | 'bridge' | 'payment' | 'onchain';
  status: string;
  timestamp: string;
  from: string;
  to: string;
  amount: number;
  token: string;
  partnerFee?: number;
  vantorFee?: number;
  totalCost?: number;
  netReceived?: number;
  txHash?: string;
  chain?: string;
  metadata?: Record<string, unknown>;
}

interface TransactionDetailModalProps {
  transaction: TransactionDetail | null;
  onClose: () => void;
}

export function TransactionDetailModal({ transaction, onClose }: TransactionDetailModalProps) {
  if (!transaction) return null;

  const totalFees = (transaction.partnerFee || 0) + (transaction.vantorFee || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Transaction Details</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <Row label="Type" value={transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)} />
          <Row label="Status" value={transaction.status} />
          <Row label="Date" value={new Date(transaction.timestamp).toLocaleString()} />
          <Row label="From" value={transaction.from} />
          <Row label="To" value={transaction.to} />

          <div className="border-t border-border my-3" />

          <Row label="Amount" value={`${transaction.amount.toLocaleString()} ${transaction.token}`} />
          {transaction.partnerFee !== undefined && transaction.partnerFee > 0 && (
            <Row label="Partner fee" value={`$${transaction.partnerFee.toFixed(2)}`} />
          )}
          {transaction.vantorFee !== undefined && transaction.vantorFee > 0 && (
            <Row label="Vantor fee (0.25%)" value={`$${transaction.vantorFee.toFixed(2)}`} />
          )}
          {totalFees > 0 && (
            <Row label="Total fees" value={`$${totalFees.toFixed(2)}`} bold />
          )}
          {transaction.netReceived !== undefined && (
            <Row label="Net received" value={`${transaction.netReceived.toLocaleString()} ${transaction.token}`} bold />
          )}

          {transaction.txHash && (
            <>
              <div className="border-t border-border my-3" />
              <Row label="Chain" value={transaction.chain || ''} />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tx Hash</span>
                <span className="font-mono text-xs truncate max-w-[200px]">{transaction.txHash}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? 'font-medium' : ''}>{value}</span>
    </div>
  );
}
