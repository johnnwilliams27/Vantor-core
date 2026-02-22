import Image from 'next/image';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata = { title: 'Sign In – Vantor' };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center">
          <Image src="/logo.png" alt="Vantor" width={160} height={80} className="object-contain" priority />
          <p className="mt-2 text-gray-500">Stablecoin Treasury Management Platform</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
