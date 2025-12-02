'use strict';

/**
 * PUBLIC_INTERFACE
 * Integration test for GET /api/llm-costs
 * Ensures that a request with page=1, limit=10, and organization_id resolves to 200 OK
 * and returns an envelope with success=true and meta.
 *
 * Note: This test assumes ALLOW_DEMO_AUTH=true in CI to bypass strict JWT.
 */

const request = require('supertest');
const app = require('../app');

describe('GET /api/llm-costs with pagination and organization_id', () => {
  it('returns 200 and an envelope when page/limit are provided', async () => {
    const res = await request(app)
      .get('/api/llm-costs')
      .set('Authorization', 'Bearer ok') // dev/demo friendly
      .query({ page: 1, limit: 10, organization_id: 'T0015' })
      .expect(res => {
        // Accept 200. In empty DB it should still return a proper envelope.
        if (![200].includes(res.status)) {
          throw new Error(`Expected 200, got ${res.status} with body: ${JSON.stringify(res.body)}`);
        }
      });

    // When envelope path is hit, success=true and meta should exist
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('page', 1);
    expect(res.body.meta).toHaveProperty('limit');
  });
});
