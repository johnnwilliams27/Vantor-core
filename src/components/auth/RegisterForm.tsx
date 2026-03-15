'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

const registerSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type RegisterFormData = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (data: RegisterFormData) => {
    setError(null);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: data.email,
        password: data.password,
        fullName: data.fullName,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Registration failed');
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push('/login'), 2000);
  };

  if (success) {
    return (
      <Card className="w-full max-w-sm shadow-lg border-gray-200">
        <CardContent className="p-8 text-center">
          <div className="text-green-600 font-semibold mb-2">Account created!</div>
          <p className="text-gray-500 text-sm">Redirecting to login…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm shadow-lg border-gray-200">
      <CardContent className="p-0">
        <div className="bg-[#19595b] rounded-t-xl px-8 py-8 flex flex-col items-center">
          <Image
            src="/logo-dark.png"
            alt="Vantor"
            width={200}
            height={78}
            className="object-contain"
            priority
            unoptimized
          />
          <p className="text-white/70 text-sm mt-3 text-center tracking-wide font-semibold">
            Agentic Stablecoin Treasury Management
          </p>
        </div>

        <div className="px-8 py-7">
          <h2 className="text-lg font-semibold text-gray-900 text-center mb-1">Create account</h2>
          <p className="text-sm text-gray-500 text-center mb-5">Register for treasury platform access</p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" placeholder="Jane Smith" {...register('fullName')} />
              {errors.fullName && <p className="text-xs text-red-500">{errors.fullName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@company.com" {...register('email')} />
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" {...register('password')} />
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input id="confirmPassword" type="password" placeholder="••••••••" {...register('confirmPassword')} />
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

          <p className="mt-5 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <a href="/login" className="text-[#19595b] hover:underline font-medium">Sign in</a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
