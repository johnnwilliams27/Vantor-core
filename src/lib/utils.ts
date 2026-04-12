import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: string | number, decimals = 2): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${mm}/${dd}/${yyyy} ${h12}:${min} ${ampm}`;
}

/** Relative time for recent items, full datetime for older ones */
export function formatRelativeOrDate(iso: string): { text: string; full: string } {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const full = formatDateTime(iso);
  if (diffMs < 0 || diffMs > 86_400_000) return { text: full, full };
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return { text: 'Just now', full };
  if (diffMin < 60) return { text: `${diffMin}m ago`, full };
  const diffHr = Math.floor(diffMin / 60);
  return { text: `${diffHr}h ago`, full };
}

/** Normalize scheduled operation status for display */
export function formatScheduledStatus(status: string): string {
  if (status === 'awaiting_authorization') return 'awaiting approval';
  return status;
}

/** Capitalizes each word; converts underscores to spaces. e.g. "payment_execute" → "Payment Execute" */
export function capitalize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Sanitize API error messages for user display */
export function sanitizeErrorMessage(message: string): string {
  // Pass through known user-friendly patterns
  if (/insufficient|balance|exceed|invalid|not found|unauthorized|forbidden|expired|limit|duplicate/i.test(message)) {
    return message;
  }
  // Hide internal/technical errors
  if (/relation|column|constraint|violates|syntax|ECONNREFUSED|timeout|500|internal/i.test(message)) {
    return 'Something went wrong. Please try again.';
  }
  // Default: pass through if it's short and doesn't look technical
  if (message.length > 200 || /\{|\[|stack|trace/i.test(message)) {
    return 'Something went wrong. Please try again.';
  }
  return message;
}

/** Format wallet for display: prefer label, fall back to truncated address */
export function walletDisplayName(wallet?: { label?: string | null; address: string } | null): string {
  if (!wallet) return '—';
  return wallet.label || `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
}
