// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotePanel } from './note-panel';

describe('NotePanel', () => {
  it('renders the eyebrow, heading, and children', () => {
    render(
      <NotePanel eyebrow="Note" heading="On yield positioning">
        <p>Your satellite allocation has drifted.</p>
      </NotePanel>,
    );
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('On yield positioning')).toBeInTheDocument();
    expect(screen.getByText('Your satellite allocation has drifted.')).toBeInTheDocument();
  });

  it('applies purple tone classes', () => {
    const { container } = render(
      <NotePanel eyebrow="Note" heading="x">
        <p>body</p>
      </NotePanel>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toMatch(/border-purple-500\/20/);
    expect(root.className).toMatch(/bg-purple-500\/5/);
  });

  it('renders optional signature line when provided', () => {
    render(
      <NotePanel eyebrow="Note" heading="x" signature="Filed 04:12">
        <p>body</p>
      </NotePanel>,
    );
    expect(screen.getByText(/Filed 04:12/)).toBeInTheDocument();
  });

  it('omits signature block when not provided', () => {
    render(
      <NotePanel eyebrow="Note" heading="x">
        <p>body</p>
      </NotePanel>,
    );
    expect(screen.queryByTestId('note-panel-signature')).not.toBeInTheDocument();
  });
});
