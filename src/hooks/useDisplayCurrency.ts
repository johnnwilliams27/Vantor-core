'use client';
import { useCallback, useSyncExternalStore } from 'react';
import type { FiatCurrency } from '@/lib/fx/rates';

const STORAGE_KEY = 'vantor-display-currency';
const DEFAULT: FiatCurrency = 'USD';

const listeners = new Set<() => void>();

function getSnapshot(): FiatCurrency {
  if (typeof window === 'undefined') return DEFAULT;
  return (localStorage.getItem(STORAGE_KEY) as FiatCurrency) ?? DEFAULT;
}

function getServerSnapshot(): FiatCurrency {
  return DEFAULT;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useDisplayCurrency() {
  const currency = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setCurrency = useCallback((c: FiatCurrency) => {
    localStorage.setItem(STORAGE_KEY, c);
    listeners.forEach((cb) => cb());
  }, []);

  return { currency, setCurrency };
}
