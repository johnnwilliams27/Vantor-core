import Image from 'next/image';
import { RegisterForm } from '@/components/auth/RegisterForm';

export const metadata = { title: 'Register – Vantor' };

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center">
          <Image src="/logo.png" alt="Vantor" width={160} height={80} className="object-contain" priority />
          <p className="mt-2 text-gray-500">Create your treasury platform account</p>
        </div>
        <RegisterForm />
      </div>
    </div>
  );
}
