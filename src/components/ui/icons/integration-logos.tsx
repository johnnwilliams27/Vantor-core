import * as React from 'react';

interface LogoProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
}

/**
 * Simplified brand marks for "coming soon" integration tiles. These are
 * deliberately stylized — recognizable-enough to signal the brand without
 * shipping pixel-exact reproductions of copyrighted logos. Swap for real
 * official SVGs once the integration is live.
 */

export function MsTeamsLogo({ size = 22, ...rest }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      {...rest}
    >
      <rect x="4" y="12" width="32" height="40" rx="5" fill="#5059C9" />
      <text
        x="20"
        y="38"
        fontSize="24"
        fontWeight="700"
        fill="#FFFFFF"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
      >
        T
      </text>
      <circle cx="48" cy="18" r="9" fill="#7B83EB" />
      <rect x="39" y="28" width="18" height="22" rx="4" fill="#7B83EB" />
    </svg>
  );
}

export function EmailLogo({ size = 22, ...rest }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      {...rest}
    >
      <rect x="6" y="14" width="52" height="36" rx="5" fill="#0EA5E9" />
      <path
        d="M10 20 L32 36 L54 20"
        stroke="#FFFFFF"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function WebhookLogo({ size = 22, ...rest }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      {...rest}
    >
      <circle cx="20" cy="20" r="8" fill="#C02A49" />
      <circle cx="44" cy="20" r="8" fill="#4B4B4B" />
      <circle cx="32" cy="48" r="8" fill="#DE6927" />
      <path
        d="M20 20 L32 48 M44 20 L32 48 M20 20 L44 20"
        stroke="#1F2937"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function ZapierLogo({ size = 22, ...rest }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      {...rest}
    >
      <circle cx="32" cy="32" r="28" fill="#FF4A00" />
      <path
        d="M20 22 L44 22 L20 42 L44 42"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function PagerDutyLogo({ size = 22, ...rest }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      {...rest}
    >
      <rect x="8" y="8" width="48" height="48" rx="6" fill="#06AC38" />
      <path
        d="M24 18 L34 18 C40 18 44 22 44 28 C44 34 40 38 34 38 L30 38 L30 48 L24 48 Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
