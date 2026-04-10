import type {
  OpenSanctionsMatchResponse,
  OpenSanctionsEntity,
  OpenSanctionsSearchResponse,
} from './types';

const MOCK_DELAY_MS = 200;

const MOCK_ENTITY: OpenSanctionsEntity = {
  id: 'mock-entity-001',
  caption: 'Mock Sanctioned Entity',
  schema: 'Person',
  properties: {
    name: ['Mock Sanctioned Entity'],
    country: ['XX'],
  },
  datasets: ['default'],
  referents: [],
  first_seen: '2024-01-01T00:00:00Z',
  last_seen: new Date().toISOString(),
  last_change: new Date().toISOString(),
};

function delay(): Promise<void> {
  return new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
}

function scoreForName(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes('sanctioned') || lower.includes('blocked')) return 0.95;
  if (lower.includes('suspicious')) return 0.75;
  return 0;
}

/**
 * Mock OpenSanctions client for development and testing.
 * Name-based triggers: "sanctioned"/"blocked" → 0.95, "suspicious" → 0.75, else 0.
 */
export class OpenSanctionsMockClient {
  async matchEntity(
    name: string,
    schema: 'Person' | 'Company',
  ): Promise<OpenSanctionsMatchResponse> {
    await delay();
    const score = scoreForName(name);
    const results: OpenSanctionsEntity[] =
      score > 0
        ? [
            {
              ...MOCK_ENTITY,
              caption: name,
              schema,
              score,
              match: score >= 0.7,
              properties: { name: [name], country: ['XX'] },
            },
          ]
        : [];

    return {
      responses: {
        q1: {
          query: { schema, properties: { name: [name] } },
          results,
          total: { value: results.length, relation: 'eq' },
        },
      },
    };
  }

  async getEntity(_entityId: string): Promise<OpenSanctionsEntity> {
    await delay();
    return { ...MOCK_ENTITY };
  }

  async search(
    query: string,
    _limit?: number,
  ): Promise<OpenSanctionsSearchResponse> {
    await delay();
    const score = scoreForName(query);
    const results: OpenSanctionsEntity[] =
      score > 0
        ? [{ ...MOCK_ENTITY, caption: query, score }]
        : [];

    return {
      results,
      total: { value: results.length, relation: 'eq' },
    };
  }
}
