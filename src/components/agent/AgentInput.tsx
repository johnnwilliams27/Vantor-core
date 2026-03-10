'use client';
import { useRef, useEffect, KeyboardEvent } from 'react';
import { SendHorizonal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgentInputProps {
  onSend: (text: string) => void;
  isStreaming: boolean;
  value: string;
  onChange: (value: string) => void;
}

export function AgentInput({ onSend, isStreaming, value, onChange }: AgentInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
  };

  return (
    <div className="border-t border-border bg-background dark:bg-gray-900 p-3">
      <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 focus-within:border-[#207679] focus-within:ring-1 focus-within:ring-[#207679]/30 transition-all">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          rows={1}
          placeholder="Ask Vantor anything… (⌘↵ to send)"
          className={cn(
            'flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-h-[24px] max-h-[160px] leading-6',
            isStreaming && 'opacity-60'
          )}
        />
        <button
          onClick={handleSend}
          disabled={isStreaming || !value.trim()}
          className={cn(
            'mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors',
            isStreaming || !value.trim()
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-[#207679] text-white hover:bg-[#195a5c]'
          )}
          aria-label="Send message"
        >
          <SendHorizonal className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
        Vantor can make mistakes. Verify important actions.
      </p>
    </div>
  );
}
