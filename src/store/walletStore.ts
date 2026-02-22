import { create } from 'zustand';
import type { Wallet, WalletBalance } from '@/types/database';

interface WalletState {
  wallets: Wallet[];
  balances: Record<string, WalletBalance[]>; // walletId → balances
  setWallets: (wallets: Wallet[]) => void;
  setBalances: (walletId: string, balances: WalletBalance[]) => void;
  updateBalance: (walletId: string, balance: WalletBalance) => void;
  clearWallets: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  wallets: [],
  balances: {},
  setWallets: (wallets) => set({ wallets }),
  setBalances: (walletId, balances) =>
    set((s) => ({ balances: { ...s.balances, [walletId]: balances } })),
  updateBalance: (walletId, newBalance) =>
    set((s) => {
      const existing = s.balances[walletId] ?? [];
      const updated = existing.map((b) =>
        b.token === newBalance.token ? newBalance : b
      );
      if (!updated.find((b) => b.token === newBalance.token)) {
        updated.push(newBalance);
      }
      return { balances: { ...s.balances, [walletId]: updated } };
    }),
  clearWallets: () => set({ wallets: [], balances: {} }),
}));
