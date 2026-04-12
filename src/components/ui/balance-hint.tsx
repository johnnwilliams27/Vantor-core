'use client';

import { useEffect, useRef, useState } from 'react';

interface BalanceHintProps {
  balance: number | null;
  token: string;
  onMax?: (max: string) => void;
  currentAmount?: string;
}

function formatBalance(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

export function BalanceHint({ balance, token, onMax, currentAmount }: BalanceHintProps) {
  const prevBalance = useRef(balance);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (balance !== null && prevBalance.current !== null && balance !== prevBalance.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(t);
    }
    prevBalance.current = balance;
  }, [balance]);

  if (balance === null) return null;

  const exceeds = currentAmount ? parseFloat(currentAmount) > balance : false;

  return (
    <div className="flex items-center justify-between mt-1">
      <span className={`text-xs transition-colors duration-500 ${flash ? 'text-teal-400' : exceeds ? 'text-red-400 font-medium' : 'text-muted-foreground'}`}>
        {exceeds ? 'Exceeds balance: ' : 'Available: '}
        {formatBalance(balance)} {token}
      </span>
      {onMax && balance > 0 && (
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => onMax(balance.toString())}
        >
          Max
        </button>
      )}
    </div>
  );
}

interface FiatBalanceHintProps {
  balance: number | null;
  currency: string;
  currentAmount?: string;
}

export function FiatBalanceHint({ balance, currency, currentAmount }: FiatBalanceHintProps) {
  if (balance === null) return null;

  const exceeds = currentAmount ? parseFloat(currentAmount) > balance : false;
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';

  return (
    <span className={`text-xs ${exceeds ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
      {exceeds ? 'Exceeds balance: ' : 'Available: '}
      {symbol}{formatBalance(balance)}
    </span>
  );
}
