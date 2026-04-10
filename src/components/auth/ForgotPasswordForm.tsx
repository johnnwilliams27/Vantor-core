'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
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
      // The API always returns generic success; we show a neutral confirmation
      // regardless of whether the email actually exists.
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    }
  };

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
            Reset Your Password
          </p>
        </div>

        <div className="px-8 py-7">
          {sent ? (
            <div className="text-center">
              <Mail className="w-10 h-10 text-[#19595b] mx-auto mb-3" />
              <h2 className="text-base font-semibold text-gray-900 mb-2">
                Check your email
              </h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                If an account exists for{' '}
                <span className="font-medium text-gray-700">{getValues('email')}</span>,
                we&rsquo;ve sent a password reset link. It expires in 1 hour.
              </p>
              <p className="text-xs text-gray-400 mt-4">
                Didn&rsquo;t receive it? Check your spam folder, or{' '}
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className="text-[#19595b] hover:underline font-medium"
                >
                  try a different email
                </button>
                .
              </p>
              <Link
                href="/login"
                className="inline-block mt-5 text-sm text-[#19595b] hover:underline font-medium"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 text-center mb-5">
                Enter the email linked to your Vantor account and we&rsquo;ll send you a reset link.
              </p>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-xs text-red-500">{errors.email.message}</p>
                  )}
                </div>

                {error && (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-[#19595b] hover:bg-[#134849] text-white"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    'Send reset link'
                  )}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-gray-500">
                Remembered it?{' '}
                <Link href="/login" className="text-[#19595b] hover:underline font-medium">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
