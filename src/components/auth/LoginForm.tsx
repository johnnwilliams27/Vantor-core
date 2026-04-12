'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, Eye, EyeOff } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginFormData) => {
    setError(null);
    const result = await signIn('credentials', {
      email: data.email,
      password: data.password,
      redirect: false,
    });
    if (result?.error) {
      try {
        const checkRes = await fetch('/api/auth/check-verified', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: data.email }),
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (!checkData.verified) {
            setError('Please verify your email before signing in. Check your inbox for the verification link.');
            return;
          }
        }
      } catch {
        // check-verified failed — fall through to generic error
      }
      setError('Invalid email or password. Please check your credentials and try again.');
      return;
    }
    window.location.href = '/dashboard';
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
          Sign in to your account
        </p>
      </div>

      {/* Form body */}
      <div className="px-8 py-7">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="login-email" className="block text-sm font-medium text-[var(--text-200)]">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder="you@company.com"
              {...register('email')}
              className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-[border-color,box-shadow] duration-300"
            />
            {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="login-password" className="block text-sm font-medium text-[var(--text-200)]">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-[var(--teal-400)] hover:text-[var(--cyan-300)] transition-colors font-medium"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                {...register('password')}
                className="w-full px-4 py-3 pr-11 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-[border-color,box-shadow] duration-300"
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
            {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
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
              <><Loader2 size={14} className="animate-spin" /> Signing in…</>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm">
          <p className="text-[var(--text-300)]">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-[var(--teal-400)] hover:text-[var(--cyan-300)] font-medium transition-colors">
              Sign up free
            </Link>
          </p>
          <p>
            <Link href="/" className="text-[var(--text-400)] hover:text-[var(--text-200)] transition-colors">
              ← Back to home
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
