import { LoginForm } from '@/components/auth/LoginForm';

export const metadata = { title: 'Sign In – Vantor' };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <LoginForm />
    </div>
  );
}
