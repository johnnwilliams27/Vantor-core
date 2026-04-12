// src/lib/policy/approvals/notifications.ts

import { actionNotificationEmail } from '@/lib/notifications/email-templates';

const APPROVALS_BASE = '/approvals';

export function approvalRequestCreatedEmail(params: {
  movementDescription: string;
  amount: string;
  chainName: string;
  expiresAt: string;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Approval Required',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
      { label: 'Approval Chain', value: params.chainName },
      { label: 'Expires', value: params.expiresAt },
    ],
    ctaLabel: 'Review Approval',
    ctaHref: `${APPROVALS_BASE}/${params.requestId}`,
  });
}

export function approvalSlotFilledEmail(params: {
  movementDescription: string;
  amount: string;
  filledBy: string;
  slotsRemaining: number;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Approval Progress',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
      { label: 'Approved By', value: params.filledBy },
      { label: 'Slots Remaining', value: String(params.slotsRemaining) },
    ],
    ctaLabel: 'View Progress',
    ctaHref: `${APPROVALS_BASE}/${params.requestId}`,
  });
}

export function approvalExecutedEmail(params: {
  movementDescription: string;
  amount: string;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Transfer Approved & Executed',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
    ],
    ctaLabel: 'View Transaction',
    ctaHref: '/transactions',
  });
}

export function approvalDeniedEmail(params: {
  movementDescription: string;
  amount: string;
  reason: string;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Approval Denied',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
      { label: 'Reason', value: params.reason },
    ],
    ctaLabel: 'View Details',
    ctaHref: `${APPROVALS_BASE}/${params.requestId}`,
  });
}

export function approvalExpiredEmail(params: {
  movementDescription: string;
  amount: string;
  requestId: string;
}): string {
  return actionNotificationEmail({
    title: 'Approval Expired',
    details: [
      { label: 'Movement', value: params.movementDescription },
      { label: 'Amount', value: params.amount },
    ],
    ctaLabel: 'View Details',
    ctaHref: `${APPROVALS_BASE}/${params.requestId}`,
  });
}
