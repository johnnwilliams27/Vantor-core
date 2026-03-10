'use client';
import { useEffect, useRef } from 'react';
import type { AgentMessage } from '@/lib/agent/types';
import { ToolCallCard } from './ToolCallCard';
import { cn } from '@/lib/utils';

function AssistantAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#207679] text-white text-xs font-bold select-none">
      V
    </div>
  );
}

function UserAvatar({ initial }: { initial?: string }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-bold select-none">
      {initial ?? 'U'}
    </div>
  );
}

interface MessageListProps {
  messages: AgentMessage[];
  isStreaming: boolean;
  userInitial?: string;
}

export function MessageList({ messages, isStreaming, userInitial }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#207679]/10">
          <span className="text-2xl font-bold text-[#207679] dark:text-teal-400">V</span>
        </div>
        <p className="text-sm font-medium text-foreground">Ask Vantor anything</p>
        <p className="text-xs text-muted-foreground max-w-[240px]">
          Check balances, run forecasts, create payments, or get treasury insights.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {messages.map((msg, i) => {
        if (msg.role === 'user') {
          const text = typeof msg.content === 'string'
            ? msg.content
            : '';
          return (
            <div key={i} className="flex items-end justify-end gap-2">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#207679] px-3.5 py-2.5 text-sm text-white leading-relaxed whitespace-pre-wrap break-words">
                {text}
              </div>
              <UserAvatar initial={userInitial} />
            </div>
          );
        }

        // Assistant message — may have displayContent (text segments + tool calls)
        const displayContent = msg.displayContent ?? [];
        const hasDisplay = displayContent.length > 0;

        return (
          <div key={i} className="flex items-start gap-2">
            <AssistantAvatar />
            <div className="flex-1 min-w-0">
              {hasDisplay ? (
                displayContent.map((part, j) => {
                  if (part.type === 'text' && part.text) {
                    const isLastPart = j === displayContent.length - 1;
                    const showCursor = isStreaming && isLastPart && i === messages.length - 1;
                    return (
                      <div
                        key={j}
                        className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words mb-1"
                      >
                        {part.text}
                        {showCursor && (
                          <span className="ml-0.5 inline-block w-0.5 h-4 bg-muted-foreground animate-pulse align-middle" />
                        )}
                      </div>
                    );
                  }
                  if (part.type === 'tool_call' && part.toolCall) {
                    return <ToolCallCard key={j} toolCall={part.toolCall} />;
                  }
                  return null;
                })
              ) : (
                // Fallback for messages without displayContent
                <div className={cn(
                  'rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words',
                  isStreaming && i === messages.length - 1 && 'after:ml-0.5 after:inline-block after:w-0.5 after:h-4 after:bg-muted-foreground after:animate-pulse after:align-middle'
                )}>
                  {typeof msg.content === 'string' ? msg.content : ''}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Streaming indicator when assistant hasn't started text yet */}
      {isStreaming && messages[messages.length - 1]?.role === 'user' && (
        <div className="flex items-start gap-2">
          <AssistantAvatar />
          <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
