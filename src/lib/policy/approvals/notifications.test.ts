// src/lib/policy/approvals/notifications.test.ts

import { describe, it, expect } from 'vitest';
import {
  approvalRequestCreatedEmail,
  approvalSlotFilledEmail,
  approvalExecutedEmail,
  approvalDeniedEmail,
  approvalExpiredEmail,
} from './notifications';

describe('approval notification emails', () => {
  it('approvalRequestCreatedEmail contains title and CTA', () => {
    const html = approvalRequestCreatedEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      chainName: 'Dual Approval',
      expiresAt: '2026-04-13 12:00 UTC',
      requestId: 'req-001',
    });

    expect(html).toContain('Approval Required');
    expect(html).toContain('Review Approval');
    expect(html).toContain('/approvals/req-001');
    expect(html).toContain('$10,000');
    expect(html).toContain('Dual Approval');
  });

  it('approvalSlotFilledEmail contains title and CTA', () => {
    const html = approvalSlotFilledEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      filledBy: 'alice@vantor.xyz',
      slotsRemaining: 1,
      requestId: 'req-001',
    });

    expect(html).toContain('Approval Progress');
    expect(html).toContain('View Progress');
    expect(html).toContain('/approvals/req-001');
    expect(html).toContain('alice@vantor.xyz');
  });

  it('approvalExecutedEmail contains title and CTA', () => {
    const html = approvalExecutedEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      requestId: 'req-001',
    });

    expect(html).toMatch(/Transfer Approved (&|&amp;) Executed/);
    expect(html).toContain('View Transaction');
    expect(html).toContain('/transactions');
  });

  it('approvalDeniedEmail contains title and CTA', () => {
    const html = approvalDeniedEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      reason: 'Manual denial by treasury manager',
      requestId: 'req-001',
    });

    expect(html).toContain('Approval Denied');
    expect(html).toContain('View Details');
    expect(html).toContain('/approvals/req-001');
    expect(html).toContain('Manual denial');
  });

  it('approvalExpiredEmail contains title and CTA', () => {
    const html = approvalExpiredEmail({
      movementDescription: 'USDC transfer to 0xabc',
      amount: '$10,000',
      requestId: 'req-001',
    });

    expect(html).toContain('Approval Expired');
    expect(html).toContain('View Details');
    expect(html).toContain('/approvals/req-001');
  });
});
