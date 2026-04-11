'use client';

import { useState, useRef } from 'react';
import { Send, CheckCircle2 } from 'lucide-react';

export function ContactForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('sending');
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fd.get('name'),
          email: fd.get('email'),
          company: fd.get('company'),
          message: fd.get('message'),
        }),
      });
      if (!res.ok) throw new Error();
      setStatus('sent');
      formRef.current?.reset();
    } catch {
      setStatus('error');
    }
  };

  return (
    <section id="contact" className="relative py-24 lg:py-32 scroll-mt-20" style={{ background: 'var(--bg-deep-navy)' }}>
      <div className="max-w-2xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl font-semibold text-white text-center mb-12 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Get in touch
        </h2>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="p-8 sm:p-10 rounded-xl bg-white/[0.025] border border-white/[0.06] space-y-6"
        >
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-[var(--text-200)] mb-2">Name</label>
              <input
                name="name"
                required
                className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-all duration-300"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-200)] mb-2">Email</label>
              <input
                name="email"
                type="email"
                required
                className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-all duration-300"
                placeholder="you@company.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-200)] mb-2">Company</label>
            <input
              name="company"
              className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-all duration-300"
              placeholder="Company name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-200)] mb-2">Message</label>
            <textarea
              name="message"
              required
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-all duration-300 resize-none"
              placeholder="Tell us about your treasury needs..."
            />
          </div>
          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full sm:w-auto min-h-[48px] px-8 py-3.5 rounded-full text-sm font-semibold bg-gradient-to-r from-teal-500 to-cyan-400 text-white hover:shadow-[0_0_32px_rgba(45,212,191,0.4)] transition-all duration-500 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {status === 'sending' ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send size={16} />
                Send Message
              </>
            )}
          </button>
          {status === 'sent' && (
            <p className="text-[var(--teal-400)] text-sm flex items-center gap-2">
              <CheckCircle2 size={16} /> Message sent. We&apos;ll be in touch shortly.
            </p>
          )}
          {status === 'error' && (
            <p className="text-red-400 text-sm">Something went wrong. Please email contact@vantor.xyz directly.</p>
          )}
        </form>
      </div>
    </section>
  );
}
