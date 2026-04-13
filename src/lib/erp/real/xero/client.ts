import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  ContactsResponseSchema, type ContactsResponse,
  InvoicesResponseSchema, type InvoicesResponse,
  AccountsResponseSchema, type AccountsResponse,
  PaymentsResponseSchema, type PaymentsResponse,
  ConnectionsResponseSchema, type ConnectionsResponse,
  type TokenResponse,
} from './schemas';
import {
  xeroUpstreamFailure,
  xeroRateLimited,
  xeroAuthExpired,
  xeroValidation,
} from './errors';
import { isExpiringSoon } from './tokens';

const API_BASE = 'https://api.xero.com';

export interface XeroClientInput {
  connectionId: string;
  tenantId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  /** Callback that performs a refresh + returns the new token response. */
  refresh: () => Promise<TokenResponse>;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export class XeroClient {
  private accessToken: string;
  private accessTokenExpiresAt: Date;
  private refreshToken: string;
  private readonly connectionId: string;
  private readonly tenantId: string;
  private readonly refresh: () => Promise<TokenResponse>;

  constructor(input: XeroClientInput) {
    this.connectionId = input.connectionId;
    this.tenantId = input.tenantId;
    this.accessToken = input.accessToken;
    this.accessTokenExpiresAt = input.accessTokenExpiresAt;
    this.refreshToken = input.refreshToken;
    this.refresh = input.refresh;
  }

  private async ensureFreshToken(): Promise<void> {
    if (isExpiringSoon(this.accessTokenExpiresAt)) {
      const refreshed = await this.refresh();
      this.accessToken = refreshed.access_token;
      this.refreshToken = refreshed.refresh_token;
      this.accessTokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    }
  }

  private async request<T>(opts: RequestOptions, schema: z.ZodType<T>): Promise<T> {
    await this.ensureFreshToken();
    const url = new URL(`${API_BASE}${opts.path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
    }
    const traceId = randomUUID();

    const doFetch = async (accessToken: string): Promise<Response> => {
      return fetch(url.toString(), {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'xero-tenant-id': this.tenantId,
          Accept: 'application/json',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    };

    let res: Response;
    try {
      res = await doFetch(this.accessToken);
    } catch (err) {
      throw xeroUpstreamFailure({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: traceId,
        cause: (err as Error).message,
      });
    }

    // Reactive refresh on 401.
    if (res.status === 401) {
      const refreshed = await this.refresh();
      this.accessToken = refreshed.access_token;
      this.refreshToken = refreshed.refresh_token;
      this.accessTokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
      try {
        res = await doFetch(this.accessToken);
      } catch (err) {
        throw xeroUpstreamFailure({
          connection_id: this.connectionId,
          xero_tenant_id: this.tenantId,
          endpoint: opts.path,
          trace_id: traceId,
          cause: (err as Error).message,
        });
      }
      if (res.status === 401) {
        throw xeroAuthExpired({
          connection_id: this.connectionId,
          xero_tenant_id: this.tenantId,
          endpoint: opts.path,
          trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        });
      }
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '60');
      const dailyRemainingRaw = res.headers.get('X-DayLimit-Remaining');
      const dailyRemaining = dailyRemainingRaw !== null ? Number(dailyRemainingRaw) : undefined;
      throw xeroRateLimited({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        retry_after_seconds: retryAfter,
        daily_limit_remaining: dailyRemaining,
      });
    }

    if (res.status >= 500) {
      throw xeroUpstreamFailure({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        status: res.status,
      });
    }

    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw xeroValidation({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        zod_issues: [{ path: [], message: 'invalid JSON' }],
        body_prefix: raw,
      });
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw xeroValidation({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        zod_issues: result.error.issues,
        body_prefix: raw,
      });
    }
    return result.data;
  }

  async getContacts(): Promise<ContactsResponse> {
    return this.request(
      { path: '/api.xro/2.0/Contacts', query: { where: 'IsSupplier==true' } },
      ContactsResponseSchema,
    );
  }

  async getInvoices(): Promise<InvoicesResponse> {
    return this.request(
      { path: '/api.xro/2.0/Invoices', query: { where: 'Type=="ACCPAY"' } },
      InvoicesResponseSchema,
    );
  }

  async getBankAccounts(): Promise<AccountsResponse> {
    return this.request(
      { path: '/api.xro/2.0/Accounts', query: { where: 'Type=="BANK"' } },
      AccountsResponseSchema,
    );
  }

  async getConnections(): Promise<ConnectionsResponse> {
    return this.request({ path: '/connections' }, ConnectionsResponseSchema);
  }

  async createPayment(input: {
    invoiceId: string;
    bankAccountId: string;
    amount: number;
    paymentDate: string;
    reference: string;
  }): Promise<PaymentsResponse> {
    return this.request(
      {
        method: 'POST',
        path: '/api.xro/2.0/Payments',
        body: {
          Invoice: { InvoiceID: input.invoiceId },
          Account: { AccountID: input.bankAccountId },
          Date: input.paymentDate,
          Amount: input.amount,
          CurrencyRate: 1,
          Reference: input.reference,
        },
      },
      PaymentsResponseSchema,
    );
  }
}
