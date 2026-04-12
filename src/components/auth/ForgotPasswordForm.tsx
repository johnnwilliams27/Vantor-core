'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, Mail } from 'lucide-react';

const schema = z.object({
  email: z.string().email('Invalid email'),
});

type FormData = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      });
      if (res.status === 429) {
        setError('Too many requests. Please try again in a little while.');
        return;
      }
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    }
  };

  return (
    <div className="w-full max-w-md landing-card p-0 overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-6 flex flex-col items-center border-b border-white/[0.06]">
        <Image
          src="/logo-dark.png"
          alt="Vantor"
          width={160}
          height={52}
          className="object-contain"
          priority
          unoptimized
        />
        <p
          className="text-[var(--text-300)] text-sm mt-3 text-center"
          style={{ letterSpacing: '-0.005em' }}
        >
          Reset your password
        </p>
      </div>

      {/* Body */}
      <div className="px-8 py-7">
        {sent ? (
          <div className="text-center">
            <Mail className="w-10 h-10 text-[var(--teal-400)] mx-auto mb-3" />
            <h2 className="text-base font-semibold text-white mb-2">
              Check your email
            </h2>
            <p className="text-sm text-[var(--text-300)] leading-relaxed">
              If an account exists for{' '}
              <span className="font-medium text-white">{getValues('email')}</span>,
              we&rsquo;ve sent a password reset link. It expires in 1 hour.
            </p>
            <p className="text-xs text-[var(--text-400)] mt-4">
              Didn&rsquo;t receive it? Check your spam folder, or{' '}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="text-[var(--teal-400)] hover:text-[var(--cyan-300)] font-medium transition-colors"
              >
                try a different email
              </button>
              .
            </p>
            <Link
              href="/login"
              className="inline-block mt-5 text-sm text-[var(--teal-400)] hover:text-[var(--cyan-300)] font-medium transition-colors"
            >
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-[var(--text-300)] text-center mb-5">
              Enter the email linked to your Vantor account and we&rsquo;ll send you a reset link.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="forgot-email" className="block text-sm font-medium text-[var(--text-200)]">
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@company.com"
                  {...register('email')}
                  className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-[border-color,box-shadow] duration-300"
                />
                {errors.email && (
                  <p className="text-xs text-red-400">{errors.email.message}</p>
                )}
              </div>

              {error && (
                <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[48px] py-3 text-sm btn-gradient disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <><Loader2 size={14} className="animate-spin" /> Sending…</>
                ) : (
                  'Send reset link'
                )}
              </button>
            </form>

            <p className="mt-5 text-center text-sm text-[var(--text-300)]">
              Remembered it?{' '}
              <Link href="/login" className="text-[var(--teal-400)] hover:text-[var(--cyan-300)] font-medium transition-colors">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
