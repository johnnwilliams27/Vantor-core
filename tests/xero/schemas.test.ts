import { describe, it, expect } from 'vitest';
import {
  TokenResponseSchema,
  ConnectionsResponseSchema,
  ContactsResponseSchema,
  InvoicesResponseSchema,
  AccountsResponseSchema,
  PaymentsResponseSchema,
} from '@/lib/erp/real/xero/schemas';
import { loadFixture } from '../helpers/msw-xero';

describe('Xero schemas', () => {
  it('parses token-refresh fixture', () => {
    const parsed = TokenResponseSchema.parse(loadFixture('token-refresh'));
    expect(parsed.access_token).toBeDefined();
    expect(parsed.refresh_token).toBeDefined();
    expect(parsed.expires_in).toBeGreaterThan(0);
  });

  it('parses connections fixture', () => {
    const raw = loadFixture<{ response: unknown }>('connections');
    const parsed = ConnectionsResponseSchema.parse(raw.response);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tenantType).toBe('ORGANISATION');
  });

  it('parses contacts fixture', () => {
    const parsed = ContactsResponseSchema.parse(loadFixture('contacts'));
    expect(parsed.Contacts.length).toBeGreaterThan(0);
    expect(parsed.Contacts[0].IsSupplier).toBe(true);
  });

  it('parses invoices fixture', () => {
    const parsed = InvoicesResponseSchema.parse(loadFixture('invoices'));
    expect(parsed.Invoices[0].Type).toBe('ACCPAY');
  });

  it('parses accounts-bank fixture', () => {
    const parsed = AccountsResponseSchema.parse(loadFixture('accounts-bank'));
    expect(parsed.Accounts[0].Type).toBe('BANK');
  });

  it('parses payment fixture', () => {
    const parsed = PaymentsResponseSchema.parse(loadFixture('payment'));
    expect(parsed.Payments[0].PaymentID).toBeDefined();
  });

  it('rejects a contacts response missing the Contacts array', () => {
    expect(() => ContactsResponseSchema.parse({ Status: 'OK' })).toThrow();
  });

  it('ignores unknown top-level fields on contacts', () => {
    const parsed = ContactsResponseSchema.parse({
      ...loadFixture('contacts') as object,
      SomeNewFieldXeroAdded: 42,
    });
    expect(parsed.Contacts.length).toBeGreaterThan(0);
  });
});
