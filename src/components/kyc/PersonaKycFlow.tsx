'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Spinner } from '@/components/ui/spinner';

interface PersonaKycFlowProps {
  onComplete: () => void;
  onError?: (error: string) => void;
}

export function PersonaKycFlow({ onComplete, onError }: PersonaKycFlowProps) {
  const { update: updateSession } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const startInquiry = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/kyc/start', { method: 'POST' });
      const data = await res.json();

      if (data.status === 'already_completed') {
        await updateSession();
        onComplete();
        return;
      }

      if (!data.inquiryId) {
        throw new Error(data.error || 'Failed to start KYC');
      }

      // @ts-ignore — Persona SDK loaded via script tag
      const client = new window.Persona.Client({
        inquiryId: data.inquiryId,
        sessionToken: data.sessionToken,
        environment: process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT || 'sandbox',
        onComplete: async () => {
          // Mark KYC as completed in our DB directly (don't wait for webhook)
          await fetch('/api/kyc/complete', { method: 'POST' });
          onComplete();
        },
        onCancel: () => {
          setStarted(false);
          setLoading(false);
        },
        onError: (err: any) => {
          setError(err.message || 'Verification failed');
          setStarted(false);
          setLoading(false);
          onError?.(err.message);
        },
      });

      client.open();
      setStarted(true);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to start verification');
      setLoading(false);
      onError?.(err.message);
    }
  }, [onComplete, onError, updateSession]);

  const loadAndStart = useCallback(() => {
    // @ts-ignore
    if (window.Persona) {
      startInquiry();
      return;
    }

    setLoading(true);
    const existing = document.querySelector('script[src*="persona"]');
    if (existing) {
      startInquiry();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.withpersona.com/dist/persona-v5.0.0.js';
    script.onload = () => startInquiry();
    document.body.appendChild(script);
  }, [startInquiry]);

  if (error) {
    return (
      <div className="text-center py-6">
        <p className="text-red-400 text-sm mb-4">{error}</p>
        <button
          onClick={loadAndStart}
          className="px-4 py-2 rounded-lg bg-[#19595b] hover:bg-[#134849] text-white text-sm transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <Spinner size="sm" />
        <p className="text-muted-foreground text-sm">Starting verification...</p>
      </div>
    );
  }

  if (started) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <p>Complete the verification in the Persona window.</p>
        <p className="text-xs mt-2 text-muted-foreground/60">If the window didn&apos;t open, check your popup blocker.</p>
      </div>
    );
  }

  return (
    <div className="text-center py-6">
      <p className="text-sm text-muted-foreground mb-4">
        We need to verify your identity before upgrading. This takes about 2 minutes.
      </p>
      <button
        onClick={loadAndStart}
        className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-teal-500 to-cyan-400 text-white text-sm font-semibold shadow-[0_0_12px_rgba(45,212,191,0.2)] hover:shadow-[0_0_20px_rgba(45,212,191,0.35)] transition-all"
      >
        Begin Verification
      </button>
    </div>
  );
}
