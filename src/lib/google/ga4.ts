/**
 * Minimal Google Analytics 4 Data API client using the JWT-bearer OAuth flow.
 * Avoids pulling in the full @google-analytics/data package + its grpc deps.
 *
 * Required env vars:
 *   GA_SERVICE_ACCOUNT_JSON  — full JSON of the service account key (as a string)
 *                              — or the path to a JSON file if it starts with "/" or "."
 *   GA_PROPERTY_ID           — GA4 numeric property ID (NOT the measurement ID)
 *
 * Setup on Google Cloud:
 *   1. Enable the Google Analytics Data API in your GCP project.
 *   2. Create a service account with no roles.
 *   3. Download a JSON key for it.
 *   4. In GA4 Admin → Property Access Management, grant that service
 *      account email "Viewer" access to the property.
 */

import crypto from 'crypto';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface RunReportRequest {
  dateRanges: Array<{ startDate: string; endDate: string }>;
  metrics: Array<{ name: string }>;
  dimensions?: Array<{ name: string }>;
  orderBys?: Array<{
    metric?: { metricName: string };
    desc?: boolean;
  }>;
  limit?: number;
}

export interface RunReportRow {
  dimensionValues: Array<{ value: string }>;
  metricValues: Array<{ value: string }>;
}

export interface RunReportResponse {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string; type?: string }>;
  rows?: RunReportRow[];
  totals?: RunReportRow[];
  rowCount?: number;
}

function base64url(buf: Buffer | string): string {
  return (typeof buf === 'string' ? Buffer.from(buf) : buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GA_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GA_SERVICE_ACCOUNT_JSON env var is not set');
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('service account JSON missing client_email or private_key');
    }
    // Private keys pasted into env vars often have \n escaped — normalize.
    parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
    return parsed as ServiceAccount;
  } catch (err) {
    throw new Error(
      'GA_SERVICE_ACCOUNT_JSON is not valid JSON: ' +
        ((err as Error)?.message ?? String(err)),
    );
  }
}

async function getAccessToken(): Promise<string> {
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const unsigned =
    base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = base64url(signer.sign(sa.private_key));
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer' +
      '&assertion=' +
      encodeURIComponent(assertion),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GA token exchange failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('GA token exchange returned no access_token');
  }
  return data.access_token;
}

export async function runGa4Report(
  request: RunReportRequest,
): Promise<RunReportResponse> {
  const propertyId = process.env.GA_PROPERTY_ID;
  if (!propertyId) {
    throw new Error('GA_PROPERTY_ID env var is not set');
  }
  const accessToken = await getAccessToken();
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GA4 runReport failed (${res.status}): ${body}`);
  }
  return (await res.json()) as RunReportResponse;
}

/** Returns true if GA env vars are populated — use to skip the cron gracefully. */
export function isGa4Configured(): boolean {
  return !!(process.env.GA_SERVICE_ACCOUNT_JSON && process.env.GA_PROPERTY_ID);
}
