'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const schema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

type FormData = z.infer<typeof schema>;

const inputClass =
  'w-full px-4 py-3 pr-11 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-[border-color,box-shadow] duration-300';

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: data.password }),
      });
      if (res.status === 429) {
        setServerError('Too many attempts. Please try again in a little while.');
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setServerError(body?.error ?? 'Failed to reset password.');
        return;
      }
      setSuccess(true);
    } catch {
      setServerError('Something went wrong. Please try again.');
    }
  };

  const missingToken = !token;

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
          Choose a new password
        </p>
      </div>

      {/* Body */}
      <div className="px-8 py-7">
        {missingToken ? (
          <div className="text-center">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <h2 className="text-base font-semibold text-white mb-2">Invalid reset link</h2>
            <p className="text-sm text-[var(--text-300)] leading-relaxed">
              This reset link is missing a token. Please request a new one.
            </p>
            <Link
              href="/forgot-password"
              className={cn(buttonVariants({ size: 'lg' }), 'mt-5 min-h-[44px]')}
            >
              Request new link
            </Link>
          </div>
        ) : success ? (
          <div className="text-center">
            <CheckCircle2 className="w-10 h-10 text-[var(--teal-400)] mx-auto mb-3" />
            <h2 className="text-base font-semibold text-white mb-2">Password updated</h2>
            <p className="text-sm text-[var(--text-300)] leading-relaxed">
              Your password has been reset. You can now sign in with your new password.
            </p>
            <Link
              href="/login"
              className={cn(buttonVariants({ size: 'lg' }), 'mt-5 min-h-[44px]')}
            >
              Sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-[var(--text-300)] text-center mb-5">
              Enter a new password for your Vantor account.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="reset-password" className="block text-sm font-medium text-[var(--text-200)]">New password</label>
                <div className="relative">
                  <input
                    id="reset-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    {...register('password')}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-400)] hover:text-[var(--text-200)] transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="reset-confirm" className="block text-sm font-medium text-[var(--text-200)]">Confirm password</label>
                <div className="relative">
                  <input
                    id="reset-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    {...register('confirmPassword')}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-400)] hover:text-[var(--text-200)] transition-colors"
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
              </div>

              <p className="text-2xs text-[var(--text-400)] leading-relaxed">
                Must be at least 8 characters and include one uppercase letter and one special character.
              </p>

              {serverError && (
                <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400">
                  {serverError}
                </div>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[48px]"
                size="lg"
              >
                {isSubmitting ? (
                  <><Loader2 size={14} className="animate-spin mr-2" /> Updating…</>
                ) : (
                  'Update password'
                )}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-[var(--text-300)]">
              <Link href="/login" className="text-[var(--teal-400)] hover:text-[var(--cyan-300)] font-medium transition-colors">
                ← Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
