'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { CheckCircle2, XCircle, Clock, Mail } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const statusConfig = {
  success: {
    icon: CheckCircle2,
    iconColor: 'text-teal-400',
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
    iconColor: 'text-teal-400',
    title: 'Already Verified',
    message: 'Your email is already verified. You can sign in to your account.',
    showLogin: true,
  },
  pending: {
    icon: Mail,
    iconColor: 'text-teal-400',
    title: 'Check Your Email',
    message: 'We sent a verification link to your email address. Please click the link to activate your account.',
    showLogin: false,
  },
};

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const status = (searchParams.get('status') || 'pending') as keyof typeof statusConfig;
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060d1f] px-4">
      <Card className="w-full max-w-sm shadow-lg border-white/10 bg-white/[0.03] backdrop-blur-sm">
        <CardContent className="p-0">
          <div className="bg-[#19595b] rounded-t-xl px-8 py-6 flex flex-col items-center">
            <Image
              src="/logo-dark.png"
              alt="Vantor"
              width={200}
              height={78}
              className="object-contain"
              priority
              unoptimized
            />
          </div>

          <div className="px-8 py-8 text-center">
            <Icon className={`w-12 h-12 mx-auto mb-4 ${config.iconColor}`} />
            <h2 className="text-lg font-semibold text-white mb-2">{config.title}</h2>
            <p className="text-sm text-gray-400 leading-relaxed">{config.message}</p>

            {config.showLogin && (
              <Link
                href="/login"
                className="inline-block mt-6 px-6 py-2.5 rounded-lg bg-[#19595b] hover:bg-[#134849] text-white text-sm font-medium transition-colors"
              >
                Sign in
              </Link>
            )}

            {status === 'expired' && (
              <Link
                href="/register"
                className="inline-block mt-6 px-6 py-2.5 rounded-lg bg-[#19595b] hover:bg-[#134849] text-white text-sm font-medium transition-colors"
              >
                Register again
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
