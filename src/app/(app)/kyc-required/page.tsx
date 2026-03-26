'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PersonaKycFlow } from '@/components/kyc/PersonaKycFlow';
import { Shield } from 'lucide-react';

export default function KycRequiredPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const handleComplete = () => {
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Shield className="w-16 h-16 text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Identity Verification Required</h1>
          <p className="text-muted-foreground mt-2">
            Your organization has upgraded to a paid plan. Please complete identity verification to access the platform.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <PersonaKycFlow onComplete={handleComplete} />
        </div>
      </div>
    </div>
  );
}
