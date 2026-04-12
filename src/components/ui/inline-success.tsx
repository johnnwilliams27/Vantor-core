'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface InlineSuccessProps {
  message: string;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms (default 5000) */
  duration?: number;
}

export function InlineSuccess({ message, onDismiss, duration = 5000 }: InlineSuccessProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // wait for fade-out
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const el = document.querySelector('[data-history-table]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-teal-500/20 bg-teal-500/[0.06] px-4 py-3 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      role="status"
    >
      <CheckCircle2 className="h-5 w-5 text-teal-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-teal-300">{message}</p>
        <button
          onClick={() => {
            const el = document.querySelector('[data-history-table]');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          className="text-xs text-teal-400/70 hover:text-teal-400 transition-colors mt-0.5"
        >
          View in history ↓
        </button>
      </div>
    </div>
  );
}
