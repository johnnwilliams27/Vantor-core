'use client';
import { useState, useCallback } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import type Anthropic from '@anthropic-ai/sdk';
import { useAppStore } from '@/store/appStore';
import type { AgentMessage, SseEvent, ToolCallDisplay } from '@/lib/agent/types';
import { MessageList } from './MessageList';
import { AgentInput } from './AgentInput';

function buildAnthropicHistory(messages: AgentMessage[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => typeof m.content === 'string' && m.content.trim())
    .map((m) => ({
      role: m.role,
      content: m.content as string,
    }));
}

export function AgentPanel() {
  const {
    agentPanelOpen, toggleAgentPanel,
    agentMessages: messages, setAgentMessages: setMessages, clearAgentMessages,
    agentIsStreaming: isStreaming, setAgentIsStreaming: setIsStreaming,
  } = useAppStore();
  const { data: session } = useSession();

  const [inputValue, setInputValue] = useState('');

  const userInitial = session?.user?.name?.charAt(0).toUpperCase() ?? session?.user?.email?.charAt(0).toUpperCase() ?? 'U';

  const sendMessage = useCallback(async (text: string) => {
    if (isStreaming) return;

    const userMsg: AgentMessage = { role: 'user', content: text, displayContent: [{ type: 'text', text }] };
    const newAssistant: AgentMessage = { role: 'assistant', content: '', displayContent: [] };

    // Snapshot current messages for history before state update
    const historySnapshot = [...messages, userMsg];

    setMessages((prev) => [...prev, userMsg, newAssistant]);
    setInputValue('');
    setIsStreaming(true);

    try {
      const history = buildAnthropicHistory(historySnapshot);

      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Track pending tool calls by id
      const pendingTools = new Map<string, ToolCallDisplay>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event: SseEvent;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (!last || last.role !== 'assistant') return prev;

            const display = [...(last.displayContent ?? [])];

            if (event.type === 'text_delta') {
              const lastPart = display[display.length - 1];
              if (lastPart?.type === 'text') {
                display[display.length - 1] = { type: 'text', text: (lastPart.text ?? '') + event.delta };
              } else {
                display.push({ type: 'text', text: event.delta });
              }
            } else if (event.type === 'tool_start') {
              const toolCall: ToolCallDisplay = {
                id: event.id,
                name: event.name,
                input: event.input,
                status: 'pending',
              };
              pendingTools.set(event.id, toolCall);
              display.push({ type: 'tool_call', toolCall });
            } else if (event.type === 'tool_result') {
              const pending = pendingTools.get(event.id);
              if (pending) {
                const isError = typeof event.result === 'object' && event.result !== null && 'error' in (event.result as object);
                pending.status = isError ? 'error' : 'done';
                pending.result = event.result;
                if (isError) pending.error = (event.result as { error: string }).error;
                pendingTools.set(event.id, pending);
                // Update the existing tool_call display item
                for (let i = 0; i < display.length; i++) {
                  if (display[i].type === 'tool_call' && display[i].toolCall?.id === event.id) {
                    display[i] = { type: 'tool_call', toolCall: { ...pending } };
                    break;
                  }
                }
              }
            } else if (event.type === 'done') {
              // Final message from Anthropic — extract full text
              let fullText = '';
              for (const block of event.message.content) {
                if (block.type === 'text') fullText += block.text;
              }
              // If we already have display content keep it, just update content field
              return updated.map((m, idx) =>
                idx === updated.length - 1
                  ? { ...m, content: fullText, displayContent: display }
                  : m
              );
            } else if (event.type === 'error') {
              display.push({ type: 'text', text: `\n\nError: ${event.message}` });
            }

            updated[updated.length - 1] = { ...last, displayContent: display };
            return updated;
          });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Connection error';
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          const display = [...(last.displayContent ?? []), { type: 'text' as const, text: `\n\nError: ${errMsg}` }];
          updated[updated.length - 1] = { ...last, displayContent: display };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, messages]);

  return (
    <div
      className={`flex flex-col border-l border-border bg-background dark:bg-gray-900 transition-all duration-300 ease-in-out overflow-hidden shrink-0 ${
        agentPanelOpen ? 'fixed inset-0 z-50 w-full sm:relative sm:inset-auto sm:z-auto sm:w-[380px]' : 'w-0'
      }`}
    >
      {/* Only render contents when open to avoid focus/tab issues when hidden */}
      {agentPanelOpen && (
        <>
          {/* Header */}
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4 dark:bg-gray-900">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#19595b] text-white text-sm font-bold">
                V
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Vantor</p>
                <p className="text-xs text-muted-foreground">Treasury AI</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearAgentMessages}
                disabled={isStreaming || messages.length === 0}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Clear chat"
                title="Clear chat"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                onClick={toggleAgentPanel}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Close agent panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <MessageList
              messages={messages}
              isStreaming={isStreaming}
              userInitial={userInitial}
            />
          </div>

          {/* Input */}
          <AgentInput
            onSend={sendMessage}
            isStreaming={isStreaming}
            value={inputValue}
            onChange={setInputValue}
          />
        </>
      )}
    </div>
  );
}
