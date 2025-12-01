'use strict';

const request = require('supertest');
const app = require('../app');

/**
 * This is a light smoke test to ensure the /api/llm-costs endpoint remains reachable
 * and, when a DB is available with appropriate data, it attaches an enrichment header.
 * In CI without DB, we accept 503/504 as per bounded behavior.
 */
describe('GET /api/llm-costs user enrichment header', () => {
  it('returns X-Users-Enriched header or bounded error', async () => {
    const res = await request(app)
      .get('/api/llm-costs')
      .set('x-organization-id', 'TEST_TENANT')
      .query({ limit: 1 });

    expect([200, 503, 504]).toContain(res.statusCode);
    // When 200, the enrichment header should be present (value can vary)
    if (res.statusCode === 200) {
      expect(res.headers).toHaveProperty('x-users-enriched');
    }
  });
});
