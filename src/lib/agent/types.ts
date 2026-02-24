import type Anthropic from '@anthropic-ai/sdk';

export type UserRole = 'auditor' | 'accountant' | 'treasury_manager';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string | Anthropic.ContentBlock[];
  // For display purposes only
  displayContent?: DisplayContent[];
}

export interface DisplayContent {
  type: 'text' | 'tool_call';
  text?: string;
  toolCall?: ToolCallDisplay;
}

export interface ToolCallDisplay {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'done' | 'error';
  result?: unknown;
  error?: string;
}

// SSE event types streamed from /api/agent/chat
export type SseEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: unknown }
  | { type: 'done'; message: Anthropic.Message }
  | { type: 'error'; message: string };
