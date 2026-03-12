import { create } from 'zustand';
import type { AgentMessage } from '@/lib/agent/types';

interface AppState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  agentPanelOpen: boolean;
  toggleAgentPanel: () => void;
  setAgentPanelOpen: (open: boolean) => void;

  agentMessages: AgentMessage[];
  setAgentMessages: (messages: AgentMessage[] | ((prev: AgentMessage[]) => AgentMessage[])) => void;
  clearAgentMessages: () => void;

  agentIsStreaming: boolean;
  setAgentIsStreaming: (streaming: boolean) => void;

  testMode: boolean;
  setTestMode: (enabled: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  agentPanelOpen: false,
  toggleAgentPanel: () => set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
  setAgentPanelOpen: (open) => set({ agentPanelOpen: open }),

  agentMessages: [],
  setAgentMessages: (messages) =>
    set((s) => ({
      agentMessages: typeof messages === 'function' ? messages(s.agentMessages) : messages,
    })),
  clearAgentMessages: () => set({ agentMessages: [] }),

  agentIsStreaming: false,
  setAgentIsStreaming: (streaming) => set({ agentIsStreaming: streaming }),

  testMode: false,
  setTestMode: (enabled) => set({ testMode: enabled }),
}));
