'use client';

import { Suspense, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { CheckCircle2, XCircle, Clock, Mail } from 'lucide-react';
import { LoginBackground } from '@/components/auth/LoginBackground';

const statusConfig = {
  success: {
    icon: CheckCircle2,
    iconColor: 'text-[var(--teal-400)]',
    title: 'Email Verified',
    message: 'Your email has been verified. You can now sign in to your account.',
    showLogin: true,
  },
  invalid: {
    icon: XCircle,
    iconColor: 'text-red-400',
    title: 'Invalid Link',
    message: 'This verification link is invalid. Please check your email for the correct link or register again.',
    showLogin: false,
  },
  expired: {
    icon: Clock,
    iconColor: 'text-amber-400',
    title: 'Link Expired',
    message: 'This verification link has expired. Please register again to receive a new verification email.',
    showLogin: false,
  },
  already: {
    icon: CheckCircle2,
    iconColor: 'text-[var(--teal-400)]',
    title: 'Already Verified',
    message: 'Your email is already verified. You can sign in to your account.',
    showLogin: true,
  },
  pending: {
    icon: Mail,
    iconColor: 'text-[var(--teal-400)]',
    title: 'Check Your Email',
    message: 'We sent a verification link to your email address. Please click the link to activate your account.',
    showLogin: false,
  },
};

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const status = (searchParams.get('status') || 'pending') as keyof typeof statusConfig;
  const email = searchParams.get('email');
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;

  const checkVerification = useCallback(async () => {
    if (!email) return false;
    try {
      const res = await fetch('/api/auth/check-verified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      return data.verified === true;
    } catch {
      return false;
    }
  }, [email]);

  useEffect(() => {
    if (status !== 'pending' || !email) return;
    const interval = setInterval(async () => {
      const verified = await checkVerification();
      if (verified) {
        clearInterval(interval);
        router.replace('/verify-email?status=success');
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [status, email, checkVerification, router]);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--bg-void)] px-4">
      <LoginBackground />
      <div className="relative z-10 w-full max-w-md landing-card p-0 overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-6 flex flex-col items-center border-b border-white/[0.06]">
          <Image
            src="/logo-dark.png"
            alt="Vantor"
            width={160}
            height={52}
            className="object-contain"
            priority
            unoptimized
          />
        </div>

        {/* Body */}
        <div className="px-8 py-8 text-center">
          <Icon className={`w-12 h-12 mx-auto mb-4 ${config.iconColor}`} />
          <h2 className="text-lg font-semibold text-white mb-2">{config.title}</h2>
          <p className="text-sm text-[var(--text-300)] leading-relaxed">{config.message}</p>

          {config.showLogin && (
            <Link
              href="/login"
              className="inline-block mt-6 min-h-[44px] px-6 py-2.5 text-sm btn-gradient"
            >
              Sign in
            </Link>
          )}

          {status === 'pending' && email && (
            <p className="text-xs text-[var(--text-400)] mt-4 animate-pulse">
              This page will update automatically once verified.
            </p>
          )}

          {status === 'expired' && (
            <Link
              href="/register"
              className="inline-block mt-6 min-h-[44px] px-6 py-2.5 text-sm btn-gradient"
            >
              Register again
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
