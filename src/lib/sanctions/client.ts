import {
  getSanctionsConfig,
  type OpenSanctionsMatchResponse,
  type OpenSanctionsEntity,
  type OpenSanctionsSearchResponse,
} from './types';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 10_000;

export class OpenSanctionsClient {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl?: string, apiKey?: string) {
    const config = getSanctionsConfig();
    this.apiUrl = (apiUrl || config.apiUrl).replace(/\/$/, '');
    this.apiKey = apiKey || config.apiKey;
  }

  async matchEntity(
    name: string,
    schema: 'Person' | 'Company',
    properties?: Record<string, string[]>,
  ): Promise<OpenSanctionsMatchResponse> {
    const body = {
      queries: {
        q1: {
          schema,
          properties: {
            name: [name],
            ...properties,
          },
        },
      },
    };

    return this.request<OpenSanctionsMatchResponse>(
      'POST',
      '/match/default',
      body,
    );
  }

  async getEntity(entityId: string): Promise<OpenSanctionsEntity> {
    return this.request<OpenSanctionsEntity>('GET', `/entities/${entityId}`);
  }

  async search(
    query: string,
    limit: number = 10,
  ): Promise<OpenSanctionsSearchResponse> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.request<OpenSanctionsSearchResponse>(
      'GET',
      `/search/default?${params}`,
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(`${this.apiUrl}${path}`, {
          method,
          headers: {
            'Authorization': `ApiKey ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(
            `OpenSanctions API ${method} ${path} returned ${res.status}: ${text}`,
          );
        }

        return (await res.json()) as T;
      } catch (err) {
        lastError = err as Error;
        if ((err as Error).name === 'AbortError') {
          lastError = new Error(
            `OpenSanctions API ${method} ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`,
          );
        }
        // Retry on network/timeout errors, not on 4xx
        if (
          lastError.message.includes('returned 4') &&
          !lastError.message.includes('returned 429')
        ) {
          break;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError!;
  }
}

export function getOpenSanctionsClient(): OpenSanctionsClient {
  const config = getSanctionsConfig();
  if (config.useMock) {
    // Lazy import to avoid loading mock in production
    const { OpenSanctionsMockClient } = require('./mock-client');
    return new OpenSanctionsMockClient();
  }
  return new OpenSanctionsClient();
}
