import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';
import { LoginBackground } from '@/components/auth/LoginBackground';

export const metadata = { title: 'Sign In – Vantor' };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--bg-void)] px-4">
      <LoginBackground />
      <div className="relative z-10">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
