'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
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
    setTimeout(() => router.push('/verify-email?status=pending'), 2000);
  };

  if (success) {
    return (
      <Card className="w-full max-w-md w-full shadow-lg border-white/10 bg-white/[0.03] backdrop-blur-sm">
        <CardContent className="p-8 text-center">
          <div className="text-teal-400 font-semibold mb-2">Account created!</div>
          <p className="text-gray-400 text-sm">Check your email to verify your account.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md w-full shadow-lg border-white/10 bg-white/[0.03] backdrop-blur-sm">
      <CardContent className="p-0">
        <div className="bg-[#19595b] rounded-t-xl px-8 py-6 flex flex-col items-center">
          <Image
            src="/logo-dark.png"
            alt="Vantor"
            width={200}
            height={78}
            className="object-contain"
            priority
            unoptimized
          />
          <p className="text-white text-base mt-2 text-center font-semibold">
            Put Your Idle Treasury to Work
          </p>
        </div>

        <div className="px-8 py-6">
          <h2 className="text-lg font-semibold text-white text-center mb-4">Create account</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" placeholder="Jane Smith" {...register('fullName')} />
              {errors.fullName && <p className="text-xs text-red-500">{errors.fullName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="companyName">Company name</Label>
              <Input id="companyName" placeholder="Acme Corp" {...register('companyName')} />
              {errors.companyName && <p className="text-xs text-red-500">{errors.companyName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                {...register('email')}
                readOnly={!!inviteEmail}
                className={inviteEmail ? 'bg-gray-100 cursor-not-allowed' : ''}
              />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" {...register('password')} className="pr-10" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <div className="relative">
                <Input id="confirmPassword" type={showConfirm ? 'text' : 'password'} placeholder="••••••••" {...register('confirmPassword')} className="pr-10" />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.confirmPassword && <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>}
            </div>
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}
            <Button
              type="submit"
              className="w-full bg-[#19595b] hover:bg-[#134849] text-white"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account…</>
              ) : (
                'Create account'
              )}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-400">
            Already have an account?{' '}
            <a href="/login" className="text-teal-400 hover:text-teal-300 font-medium">Sign in</a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
