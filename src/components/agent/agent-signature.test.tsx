// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentSignature } from './agent-signature';

describe('AgentSignature', () => {
  it('renders the Agent label', () => {
    render(<AgentSignature />);
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('uses the special (purple) Badge variant', () => {
    const { container } = render(<AgentSignature />);
    const badge = container.querySelector('[class*="purple"]');
    expect(badge).not.toBeNull();
  });

  it('renders a smaller variant when subtle is true', () => {
    const { rerender, container } = render(<AgentSignature />);
    const defaultBadge = container.firstChild as HTMLElement;
    const defaultClass = defaultBadge.className;

    rerender(<AgentSignature subtle />);
    const subtleBadge = container.firstChild as HTMLElement;
    expect(subtleBadge.className).not.toBe(defaultClass);
  });
});
