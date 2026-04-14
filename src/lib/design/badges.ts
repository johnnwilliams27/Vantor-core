/**
 * Central badge semantic palette.
 *
 * Replaces 10+ scattered STATUS_COLORS / SEVERITY_COLORS / ROLE_BADGE /
 * TYPE_BADGE / CHART_BADGES maps in the codebase. See style guide
 * Section 02 for the full rationale and color rules.
 *
 * Shape is fixed at rounded-md for text-carrying badges (applied in the
 * Badge primitive). rounded-full is reserved for shape-mandated elements
 * (CountBadge, status dots, progress bars, switches).
 *
 * Opacity rules:
 *   bg: /8 or /10 (subtle tint)
 *   border: /20
 *   icon + text: full color
 */
export const BADGE = {
  /** Active · healthy · executed — brand teal, reinforces "system healthy" */
  active:   'bg-teal-500/8 text-teal-400 border-teal-500/20',
  /** Pending · attention-needed — user should act or wait */
  pending:  'bg-amber-500/8 text-amber-400 border-amber-500/20',
  /** Failed · critical · blocked — error states, must resolve */
  failed:   'bg-red-500/8 text-red-400 border-red-500/20',
  /** Info · neutral-positive — informational, no action required */
  info:     'bg-blue-500/8 text-blue-400 border-blue-500/20',
  /** Special · AI · tier — differentiated, non-default product states */
  special:  'bg-purple-500/8 text-purple-400 border-purple-500/20',
  /** Inactive · cancelled · archived — no longer active */
  inactive: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  /** Urgent · overdue · unread — breaking attention, sharper than red */
  urgent:   'bg-rose-500/10 text-rose-400 border-rose-500/20',
  /** Live · system-healthy — narrow use (mode indicators, Test/Live toggle) */
  live:     'bg-green-500/8 text-green-400 border-green-500/20',
} as const;

export type BadgeSemantic = keyof typeof BADGE;

/**
 * Semantic alias map — domain vocab → semantic tokens.
 *
 * Callers write STATUS_BADGE[row.status] instead of remembering which
 * color "executed" vs "scheduled" vs "cancelled" maps to.
 */
export const STATUS_BADGE = {
  // active family
  executed: BADGE.active,
  connected: BADGE.active,
  fresh: BADGE.active,
  healthy: BADGE.active,
  succeeded: BADGE.active,
  // pending family
  pending: BADGE.pending,
  scheduled: BADGE.pending,
  stale: BADGE.pending,
  queued: BADGE.pending,
  processing: BADGE.pending,
  // failed family
  failed: BADGE.failed,
  blocked: BADGE.failed,
  error: BADGE.failed,
  rejected: BADGE.failed,
  // inactive family
  cancelled: BADGE.inactive,
  archived: BADGE.inactive,
  draft: BADGE.inactive,
  inactive: BADGE.inactive,
  disabled: BADGE.inactive,
} as const;

/**
 * Role palette — categorical hues (color differentiates, not signifies).
 * Used for user role badges in settings/accounts and admin surfaces.
 */
export const ROLE_BADGE = {
  owner: BADGE.active,
  enterprise_admin: BADGE.info,
  executive: BADGE.special,
  member: BADGE.inactive,
  app_admin: BADGE.urgent,
} as const;

/**
 * Transaction type palette — categorical hues.
 * Used for transaction type badges in tables across the app.
 */
export const TYPE_BADGE = {
  transfer: BADGE.info,
  swap: BADGE.special,
  bridge: BADGE.active,
  ramp: BADGE.pending,
  payment: BADGE.inactive,
  deposit: BADGE.active,
  withdrawal: BADGE.pending,
} as const;
