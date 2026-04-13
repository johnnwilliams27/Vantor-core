import * as React from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * Agent signature — the canonical "this is agent-authored" visual mark.
 * Renders the purple Badge (variant="special") used across the Agent
 * Surfaces system. Single source of truth for Agent labelling; callers
 * should use this instead of inlining <Badge variant="special">Agent</Badge>.
 *
 * See docs/superpowers/specs/2026-04-13-agent-surfaces-design.md §8.1.
 */
interface AgentSignatureProps {
  /** When true, uses xs size for inline contexts (e.g. table rows). */
  subtle?: boolean;
}

export function AgentSignature({ subtle = false }: AgentSignatureProps) {
  return (
    <Badge variant="special" size={subtle ? 'xs' : 'sm'} dot>
      Agent
    </Badge>
  );
}
