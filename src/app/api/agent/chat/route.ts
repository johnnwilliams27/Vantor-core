import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import Anthropic from '@anthropic-ai/sdk';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildSystemPrompt } from '@/lib/agent/context';
import { getToolsForRole, dispatchTool } from '@/lib/agent/tools';
import type { UserRole, SseEvent } from '@/lib/agent/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function encodeEvent(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const userId = session.user.id;
  const userRole = (session.user.role ?? 'auditor') as UserRole;

  let body: { messages: Anthropic.MessageParam[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const supabase = createAdminClient();
  const systemPrompt = await buildSystemPrompt(supabase, userId, userRole);
  const tools = getToolsForRole(userRole);
  const ctx = { supabase, userId, userRole };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SseEvent) => {
        controller.enqueue(new TextEncoder().encode(encodeEvent(event)));
      };

      try {
        // Mutable copy of messages for the agentic loop
        const messages: Anthropic.MessageParam[] = [...body.messages];

        // Agentic loop — continues until stop_reason is not 'tool_use'
        while (true) {
          const anthropicStream = anthropic.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: systemPrompt,
            tools: tools as Anthropic.Tool[],
            messages,
          });

          // Stream text deltas and tool_start events as they arrive
          let currentToolName: string | null = null;
          let currentToolId: string | null = null;
          let currentToolInputJson = '';

          for await (const event of anthropicStream) {
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'tool_use') {
                currentToolName = event.content_block.name;
                currentToolId = event.content_block.id;
                currentToolInputJson = '';
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                send({ type: 'text_delta', delta: event.delta.text });
              } else if (event.delta.type === 'input_json_delta') {
                currentToolInputJson += event.delta.partial_json;
              }
            } else if (event.type === 'content_block_stop') {
              if (currentToolName && currentToolId) {
                let toolInput: Record<string, unknown> = {};
                try {
                  toolInput = JSON.parse(currentToolInputJson || '{}');
                } catch {
                  // ignore parse errors
                }
                send({ type: 'tool_start', id: currentToolId, name: currentToolName, input: toolInput });
                currentToolName = null;
                currentToolId = null;
                currentToolInputJson = '';
              }
            }
          }

          const finalMessage = await anthropicStream.finalMessage();

          // Add the assistant message to history
          messages.push({ role: 'assistant', content: finalMessage.content });

          if (finalMessage.stop_reason !== 'tool_use') {
            send({ type: 'done', message: finalMessage });
            break;
          }

          // Execute all tool calls in this response
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of finalMessage.content) {
            if (block.type !== 'tool_use') continue;

            let result: unknown;
            let isError = false;
            try {
              result = await dispatchTool(block.name, block.input as Record<string, unknown>, ctx);
            } catch (err) {
              result = { error: err instanceof Error ? err.message : String(err) };
              isError = true;
            }

            send({ type: 'tool_result', id: block.id, name: block.name, result });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
              is_error: isError,
            });
          }

          // Add tool results to history and continue loop
          messages.push({ role: 'user', content: toolResults });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        try {
          controller.enqueue(
            new TextEncoder().encode(encodeEvent({ type: 'error', message }))
          );
        } catch {
          // Controller may already be closed
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
