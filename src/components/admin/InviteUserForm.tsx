'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';

export function InviteUserForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      const res = await fetch('/api/admin/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setSuccess(true);
        setEmail('');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to send invitation');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter email address"
        required
        className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-white text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
      >
        <Send className="w-4 h-4" />
        {loading ? 'Sending...' : 'Invite'}
      </button>
      {success && <p className="text-sm text-emerald-500 self-center">Sent!</p>}
      {error && <p className="text-sm text-red-500 self-center">{error}</p>}
    </form>
  );
}
