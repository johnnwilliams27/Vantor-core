import { setupServer } from 'msw/node';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'xero');

export function loadFixture<T = unknown>(name: string): T {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(raw) as T;
}

export interface XeroMswOptions {
  /** Override the /connect/token response (e.g., to return invalid_grant). */
  tokenResponse?: { status: number; body: JsonBodyType };
  /** Override the /Contacts response. */
  contactsResponse?: { status: number; body: JsonBodyType };
  /** Override the /Invoices response. */
  invoicesResponse?: { status: number; body: JsonBodyType };
  /** Override the /Payments POST response. */
  paymentsResponse?: { status: number; body: JsonBodyType };
  /** Override the /connections response. */
  connectionsResponse?: { status: number; body: JsonBodyType };
  /** Override the /Accounts response. */
  accountsResponse?: { status: number; body: JsonBodyType };
  /** Called on every matched handler so tests can assert call counts. */
  onCall?: (endpoint: string) => void;
}

export function makeXeroMswServer(options: XeroMswOptions = {}) {
  const token = options.tokenResponse ?? { status: 200, body: loadFixture<JsonBodyType>('token-refresh') };
  const contacts = options.contactsResponse ?? { status: 200, body: loadFixture<JsonBodyType>('contacts') };
  const invoices = options.invoicesResponse ?? { status: 200, body: loadFixture<JsonBodyType>('invoices') };
  const payments = options.paymentsResponse ?? { status: 200, body: loadFixture<JsonBodyType>('payment') };
  const connections = options.connectionsResponse
    ?? { status: 200, body: loadFixture<{ response: JsonBodyType }>('connections').response };
  const accounts = options.accountsResponse ?? { status: 200, body: loadFixture<JsonBodyType>('accounts-bank') };

  return setupServer(
    http.post('https://identity.xero.com/connect/token', () => {
      options.onCall?.('/connect/token');
      return HttpResponse.json(token.body, { status: token.status });
    }),
    http.get('https://api.xero.com/connections', () => {
      options.onCall?.('/connections');
      return HttpResponse.json(connections.body, { status: connections.status });
    }),
    http.get('https://api.xero.com/api.xro/2.0/Contacts', () => {
      options.onCall?.('/Contacts');
      return HttpResponse.json(contacts.body, { status: contacts.status });
    }),
    http.get('https://api.xero.com/api.xro/2.0/Invoices', () => {
      options.onCall?.('/Invoices');
      return HttpResponse.json(invoices.body, { status: invoices.status });
    }),
    http.get('https://api.xero.com/api.xro/2.0/Accounts', () => {
      options.onCall?.('/Accounts');
      return HttpResponse.json(accounts.body, { status: accounts.status });
    }),
    http.post('https://api.xero.com/api.xro/2.0/Payments', () => {
      options.onCall?.('/Payments');
      return HttpResponse.json(payments.body, { status: payments.status });
    }),
  );
}
