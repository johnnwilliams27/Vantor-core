import { LoginForm } from '@/components/auth/LoginForm';
import { LoginBackground } from '@/components/auth/LoginBackground';

export const metadata = { title: 'Sign In – Vantor' };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#060d1f] px-4">
      <LoginBackground />
      <div className="relative z-10">
        <LoginForm />
      </div>
    </div>
  );
}
