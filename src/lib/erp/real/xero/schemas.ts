import { z } from 'zod';

// OAuth token response (both auth-code exchange and refresh).
export const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

// /connections returns a bare array.
export const ConnectionsResponseSchema = z.array(
  z.object({
    id: z.string(),
    tenantId: z.string(),
    tenantType: z.enum(['ORGANISATION', 'PRACTICE']),
    tenantName: z.string(),
    createdDateUtc: z.string().optional(),
    updatedDateUtc: z.string().optional(),
  }),
);
export type ConnectionsResponse = z.infer<typeof ConnectionsResponseSchema>;

// Contacts (vendors on the AP side).
const ContactSchema = z.object({
  ContactID: z.string(),
  Name: z.string(),
  EmailAddress: z.string().optional(),
  IsSupplier: z.boolean().optional(),
  IsCustomer: z.boolean().optional(),
});

export const ContactsResponseSchema = z.object({
  Id: z.string().optional(),
  Status: z.string().optional(),
  Contacts: z.array(ContactSchema),
});
export type ContactsResponse = z.infer<typeof ContactsResponseSchema>;

// Invoices (ACCPAY = bills we pay).
const InvoiceLineItemSchema = z.object({
  LineItemID: z.string().optional(),
  Description: z.string().optional(),
  LineAmount: z.number().optional(),
  AccountCode: z.string().optional(),
});

const InvoiceSchema = z.object({
  InvoiceID: z.string(),
  InvoiceNumber: z.string().optional(),
  Type: z.enum(['ACCPAY', 'ACCREC']),
  Contact: z.object({ ContactID: z.string() }),
  Date: z.string().optional(),
  DueDate: z.string().optional(),
  Status: z.string().optional(),
  LineAmountTypes: z.string().optional(),
  SubTotal: z.number().optional(),
  TotalTax: z.number().optional(),
  Total: z.number(),
  AmountDue: z.number().optional(),
  AmountPaid: z.number().optional(),
  CurrencyCode: z.string(),
  LineItems: z.array(InvoiceLineItemSchema).optional(),
});

export const InvoicesResponseSchema = z.object({
  Id: z.string().optional(),
  Status: z.string().optional(),
  Invoices: z.array(InvoiceSchema),
});
export type InvoicesResponse = z.infer<typeof InvoicesResponseSchema>;

// Accounts (used to resolve bank account id).
const AccountSchema = z.object({
  AccountID: z.string(),
  Code: z.string().optional(),
  Name: z.string(),
  Type: z.string(),
  Status: z.string().optional(),
  CurrencyCode: z.string().optional(),
});

export const AccountsResponseSchema = z.object({
  Id: z.string().optional(),
  Status: z.string().optional(),
  Accounts: z.array(AccountSchema),
});
export type AccountsResponse = z.infer<typeof AccountsResponseSchema>;

// Payment response (what /Payments POST returns).
const PaymentSchema = z.object({
  PaymentID: z.string(),
  Date: z.string().optional(),
  Amount: z.number(),
  CurrencyRate: z.number().optional(),
  Reference: z.string().optional(),
  Status: z.string().optional(),
  PaymentType: z.string().optional(),
  Invoice: z.object({ InvoiceID: z.string() }),
  Account: z.object({ AccountID: z.string() }),
});

export const PaymentsResponseSchema = z.object({
  Id: z.string().optional(),
  Status: z.string().optional(),
  Payments: z.array(PaymentSchema),
});
export type PaymentsResponse = z.infer<typeof PaymentsResponseSchema>;
