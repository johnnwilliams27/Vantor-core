import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { makeXeroMswServer, loadFixture } from './msw-xero';

describe('makeXeroMswServer', () => {
  const server = makeXeroMswServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('intercepts /connections', async () => {
    const res = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: 'Bearer x' },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].tenantId).toBe('tenant-test-0001');
  });

  it('loadFixture returns parsed JSON', () => {
    const contacts = loadFixture<{ Contacts: unknown[] }>('contacts');
    expect(contacts.Contacts.length).toBeGreaterThan(0);
  });
});
