'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import { Loader2, Eye, EyeOff } from 'lucide-react';

const registerSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  companyName: z.string().min(1, 'Company name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().superRefine((val, ctx) => {
    const issues: string[] = [];
    if (val.length < 8) issues.push('at least 8 characters');
    if (!/[A-Z]/.test(val)) issues.push('one uppercase letter');
    if (!/[^A-Za-z0-9]/.test(val)) issues.push('one special character');
    if (issues.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Password must contain: ${issues.join(', ')}`,
      });
    }
  }),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type RegisterFormData = z.infer<typeof registerSchema>;

const inputClass =
  'w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-[border-color,box-shadow] duration-300';

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const inviteEmail = searchParams.get('email');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: inviteEmail ?? '',
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setError(null);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: data.email,
        password: data.password,
        fullName: data.fullName,
        companyName: data.companyName,
        ...(inviteToken ? { inviteToken } : {}),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Registration failed');
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push(`/verify-email?status=pending&email=${encodeURIComponent(data.email)}`), 2000);
  };

  if (success) {
    return (
      <div className="w-full max-w-md landing-card p-8 text-center">
        <div className="text-[var(--teal-400)] font-semibold mb-2">Account created!</div>
        <p className="text-[var(--text-300)] text-sm">Check your email to verify your account.</p>
      </div>
    );
  }

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
          Create your account
        </p>
      </div>

      {/* Form body */}
      <div className="px-8 py-7">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="reg-fullName" className="block text-sm font-medium text-[var(--text-200)]">Full name</label>
            <input
              id="reg-fullName"
              autoComplete="name"
              placeholder="Jane Smith"
              {...register('fullName')}
              className={inputClass}
            />
            {errors.fullName && <p className="text-xs text-red-400">{errors.fullName.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reg-companyName" className="block text-sm font-medium text-[var(--text-200)]">Company name</label>
            <input
              id="reg-companyName"
              autoComplete="organization"
              placeholder="Acme Corp"
              {...register('companyName')}
              className={inputClass}
            />
            {errors.companyName && <p className="text-xs text-red-400">{errors.companyName.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reg-email" className="block text-sm font-medium text-[var(--text-200)]">Email</label>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@company.com"
              {...register('email')}
              readOnly={!!inviteEmail}
              className={`${inputClass} ${inviteEmail ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reg-password" className="block text-sm font-medium text-[var(--text-200)]">Password</label>
            <div className="relative">
              <input
                id="reg-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                {...register('password')}
                className={`${inputClass} pr-11`}
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

          <div className="space-y-1.5">
            <label htmlFor="reg-confirmPassword" className="block text-sm font-medium text-[var(--text-200)]">Confirm password</label>
            <div className="relative">
              <input
                id="reg-confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                {...register('confirmPassword')}
                className={`${inputClass} pr-11`}
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
            {errors.confirmPassword && <p className="text-xs text-red-400">{errors.confirmPassword.message}</p>}
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
              <><Loader2 size={14} className="animate-spin" /> Creating account…</>
            ) : (
              'Create account'
            )}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-[var(--text-300)]">
          Already have an account?{' '}
          <a href="/login" className="text-[var(--teal-400)] hover:text-[var(--cyan-300)] font-medium transition-colors">Sign in</a>
        </p>
      </div>
    </div>
  );
}
