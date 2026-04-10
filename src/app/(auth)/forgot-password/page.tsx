import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { LoginBackground } from '@/components/auth/LoginBackground';

export const metadata = { title: 'Forgot Password – Vantor' };

export default function ForgotPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#060d1f] px-4">
      <LoginBackground />
      <div className="relative z-10">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
