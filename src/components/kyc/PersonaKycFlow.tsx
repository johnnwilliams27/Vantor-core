'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';

interface PersonaKycFlowProps {
  onComplete: () => void;
  onError?: (error: string) => void;
}

export function PersonaKycFlow({ onComplete, onError }: PersonaKycFlowProps) {
  const { update: updateSession } = useSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startInquiry = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/kyc/start', { method: 'POST' });
      const data = await res.json();

      if (data.status === 'already_completed') {
        await updateSession();
        onComplete();
        return;
      }

      if (!data.inquiryId) {
        throw new Error('Failed to start KYC');
      }

      // Load Persona embedded flow
      // @ts-ignore — Persona SDK loaded via script tag
      const client = new window.Persona.Client({
        inquiryId: data.inquiryId,
        sessionToken: data.sessionToken,
        environment: process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT || 'sandbox',
        onComplete: async () => {
          await fetch('/api/kyc/complete', { method: 'POST' });
          await updateSession();
          onComplete();
        },
        onError: (err: any) => {
          setError(err.message || 'Verification failed');
          onError?.(err.message);
        },
      });

      client.open();
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to start verification');
      onError?.(err.message);
    }
  }, [onComplete, onError, updateSession]);

  useEffect(() => {
    // Load Persona SDK script
    const script = document.createElement('script');
    script.src = 'https://cdn.withpersona.com/dist/persona-v5.0.0.js';
    script.onload = () => startInquiry();
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [startInquiry]);

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={startInquiry}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading verification...</div>;
  }

  return <div ref={containerRef} />;
}
