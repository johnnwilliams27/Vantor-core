'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

// Must match server policy (src/app/api/auth/reset-password/route.ts and register).
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

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
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
    <Card className="w-full max-w-sm shadow-lg border-gray-200">
      <CardContent className="p-0">
        <div className="bg-[#19595b] rounded-t-xl px-8 pt-8 pb-5 flex flex-col items-center">
          <Image
            src="/logo-dark.png"
            alt="Vantor"
            width={200}
            height={78}
            className="object-contain"
            priority
            unoptimized
          />
          <p className="text-white text-sm mt-3 text-center tracking-wide font-semibold">
            Choose a New Password
          </p>
        </div>

        <div className="px-8 py-7">
          {missingToken ? (
            <div className="text-center">
              <XCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h2 className="text-base font-semibold text-gray-900 mb-2">
                Invalid reset link
              </h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                This reset link is missing a token. Please request a new one.
              </p>
              <Link
                href="/forgot-password"
                className="inline-block mt-5 px-6 py-2.5 rounded-lg bg-[#19595b] hover:bg-[#134849] text-white text-sm font-medium transition-colors"
              >
                Request new link
              </Link>
            </div>
          ) : success ? (
            <div className="text-center">
              <CheckCircle2 className="w-10 h-10 text-[#19595b] mx-auto mb-3" />
              <h2 className="text-base font-semibold text-gray-900 mb-2">
                Password updated
              </h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                Your password has been reset. You can now sign in with your new password.
              </p>
              <Link
                href="/login"
                className="inline-block mt-5 px-6 py-2.5 rounded-lg bg-[#19595b] hover:bg-[#134849] text-white text-sm font-medium transition-colors"
              >
                Sign in
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 text-center mb-5">
                Enter a new password for your Vantor account.
              </p>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    {...register('password')}
                  />
                  {errors.password && (
                    <p className="text-xs text-red-500">{errors.password.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    {...register('confirmPassword')}
                  />
                  {errors.confirmPassword && (
                    <p className="text-xs text-red-500">
                      {errors.confirmPassword.message}
                    </p>
                  )}
                </div>

                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Must be at least 8 characters and include one uppercase letter and one special character.
                </p>

                {serverError && (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                    {serverError}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-[#19595b] hover:bg-[#134849] text-white"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…
                    </>
                  ) : (
                    'Update password'
                  )}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-gray-500">
                <Link href="/login" className="text-[#19595b] hover:underline font-medium">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
