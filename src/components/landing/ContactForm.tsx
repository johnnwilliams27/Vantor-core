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
    <section
      id="contact"
      className="relative py-[70px] lg:py-[102px] scroll-mt-20 overflow-hidden"
      style={{ background: 'var(--bg-deep-navy)', borderTop: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="relative max-w-[640px] mx-auto px-6">
        <p
          className="text-center text-[13px] font-semibold uppercase text-[var(--teal-400)] mb-4"
          style={{ letterSpacing: '0.12em' }}
        >
          Get in touch
        </p>
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-4 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Ready to modernize your treasury?
        </h2>
        <p
          className="text-center text-[15px] text-[var(--text-300)] max-w-[480px] mx-auto mb-10 leading-relaxed"
          style={{ letterSpacing: '-0.005em' }}
        >
          Talk to our team or start your free trial.
        </p>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="landing-card p-8 sm:p-9 space-y-6"
        >
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <label htmlFor="contact-name" className="block text-sm font-medium text-[var(--text-200)] mb-2">Name</label>
              <input
                id="contact-name"
                name="name"
                required
                autoComplete="name"
                className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-[border-color,box-shadow] duration-300"
                placeholder="Your name"
              />
            </div>
            <div>
              <label htmlFor="contact-email" className="block text-sm font-medium text-[var(--text-200)] mb-2">Email</label>
              <input
                id="contact-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-[border-color,box-shadow] duration-300"
                placeholder="you@company.com"
              />
            </div>
          </div>
          <div>
            <label htmlFor="contact-company" className="block text-sm font-medium text-[var(--text-200)] mb-2">Company</label>
            <input
              id="contact-company"
              name="company"
              autoComplete="organization"
              className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-[border-color,box-shadow] duration-300"
              placeholder="Company name"
            />
          </div>
          <div>
            <label htmlFor="contact-message" className="block text-sm font-medium text-[var(--text-200)] mb-2">Message</label>
            <textarea
              id="contact-message"
              name="message"
              required
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-[border-color,box-shadow] duration-300 resize-none"
              placeholder="Tell us about your treasury needs…"
            />
          </div>
          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full sm:w-auto min-h-[48px] px-8 py-3.5 text-sm btn-gradient disabled:opacity-60 flex items-center justify-center gap-2"
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
            <p role="status" aria-live="polite" className="text-[var(--teal-400)] text-sm flex items-center gap-2">
              <CheckCircle2 size={16} aria-hidden="true" /> Message sent. We&apos;ll be in touch shortly.
            </p>
          )}
          {status === 'error' && (
            <p role="alert" className="text-red-400 text-sm">Something went wrong. Please email contact@vantor.xyz directly.</p>
          )}
        </form>
      </div>
    </section>
  );
}
