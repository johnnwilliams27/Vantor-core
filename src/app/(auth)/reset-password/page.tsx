import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { LoginBackground } from '@/components/auth/LoginBackground';

export const metadata = { title: 'Reset Password – Vantor' };

export default function ResetPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--bg-void)] px-4">
      <LoginBackground />
      <div className="relative z-10">
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
