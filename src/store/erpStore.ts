import { create } from 'zustand';
import type { ErpConfiguration, ErpVendor } from '@/types/database';

interface ERPState {
  erpConfigs: ErpConfiguration[];
  vendors: Record<string, ErpVendor[]>; // erpConfigId → vendors
  setErpConfigs: (configs: ErpConfiguration[]) => void;
  setVendors: (erpConfigId: string, vendors: ErpVendor[]) => void;
  activeConfigId: string | null;
  setActiveConfigId: (id: string | null) => void;
}

export const useERPStore = create<ERPState>((set) => ({
  erpConfigs: [],
  vendors: {},
  activeConfigId: null,
  setErpConfigs: (configs) =>
    set({
      erpConfigs: configs,
      activeConfigId: configs.find((c) => c.is_active)?.id ?? null,
    }),
  setVendors: (erpConfigId, vendors) =>
    set((s) => ({ vendors: { ...s.vendors, [erpConfigId]: vendors } })),
  setActiveConfigId: (id) => set({ activeConfigId: id }),
}));
