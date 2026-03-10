'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
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

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
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
      setError('Invalid email or password');
      return;
    }
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <Card className="w-full max-w-sm shadow-lg border-gray-200">
      <CardContent className="p-0">
        <div className="bg-[#207679] rounded-t-xl px-8 pt-8 pb-5 flex flex-col items-center">
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
            Agentic Stablecoin Treasury Management
          </p>
        </div>

        <div className="px-8 py-7">
          <p className="text-sm text-gray-500 text-center mb-5">Enter your credentials to continue</p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}
            <Button
              type="submit"
              className="w-full bg-[#207679] hover:bg-[#195a5c] text-white"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <a href="/register" className="text-[#207679] hover:underline font-medium">Register</a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
