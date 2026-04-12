import { Suspense } from 'react';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { RegisterValueProps } from '@/components/auth/RegisterValueProps';
import { LoginBackground } from '@/components/auth/LoginBackground';

export const metadata = { title: 'Register – Vantor' };

export default function RegisterPage() {
  return (
    <div className="relative flex min-h-screen bg-[var(--bg-void)] overflow-auto">
      <LoginBackground />

      {/* Left — Sign up form */}
      <div className="relative z-10 w-full lg:w-1/2 flex items-start lg:items-center justify-center px-6 py-10 overflow-y-auto">
        <Suspense><RegisterForm /></Suspense>
      </div>

      {/* Right — Value prop cards */}
      <div className="relative z-10 hidden lg:flex lg:w-1/2 items-start lg:items-center justify-center px-8 xl:px-10 py-10 border-l border-white/[0.06] overflow-y-auto">
        <RegisterValueProps />
      </div>
    </div>
  );
}
