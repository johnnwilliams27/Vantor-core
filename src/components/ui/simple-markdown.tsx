import React from 'react';

/** Render bold (**text**) and code (`text`) inline */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-foreground font-medium">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-muted px-1 rounded text-xs">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

/** Check if a line is a sub-header (starts with emoji + bold text, e.g. "📊 **Title**") */
function isSubHeader(line: string): boolean {
  const trimmed = line.trim();
  // Check if line starts with a non-ASCII character (emoji) followed by space and bold text
  if (trimmed.length < 6) return false;
  const firstCodePoint = trimmed.codePointAt(0) ?? 0;
  if (firstCodePoint < 127) return false; // ASCII = not an emoji
  const afterEmoji = trimmed.slice(firstCodePoint > 0xffff ? 2 : 1).trim();
  return afterEmoji.startsWith('**') && afterEmoji.endsWith('**');
}

/** Lightweight markdown renderer for AI reasoning text */
export function SimpleMarkdown({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/);
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Bullet list (lines starting with - or *)
        const lines = trimmed.split('\n');
        const isList = lines.every((l) => /^\s*[-*]\s/.test(l));
        if (isList) {
          return (
            <ul key={i} className="list-disc list-inside space-y-1">
              {lines.map((line, j) => (
                <li key={j}>{renderInline(line.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }

        // Heading (### or ##)
        const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (headingMatch) {
          return (
            <p key={i} className="font-semibold text-foreground">
              {headingMatch[2]}
            </p>
          );
        }

        // Block with sub-header (emoji + **bold**) followed by body text
        if (lines.length > 1 && isSubHeader(lines[0])) {
          return (
            <div key={i}>
              <div className="text-sm font-semibold text-foreground mb-1">
                {renderInline(lines[0].trim())}
              </div>
              <p className="text-xs">{renderInline(lines.slice(1).join(' ').trim())}</p>
            </div>
          );
        }

        // Regular paragraph (may contain multiple lines)
        return (
          <p key={i}>{renderInline(trimmed.replace(/\n/g, ' '))}</p>
        );
      })}
    </div>
  );
}
