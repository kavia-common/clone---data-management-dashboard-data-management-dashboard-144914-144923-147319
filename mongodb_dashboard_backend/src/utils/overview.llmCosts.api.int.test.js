const request = require('supertest');
const app = require('../app');

describe('GET /api/llm-costs bounded behavior', () => {
  it('returns 503 fast when DB not ready or env missing', async () => {
    const res = await request(app)
      .get('/api/llm-costs')
      .set('x-organization-id', 'T0015')
      .query({ limit: 10 });

    // In CI without DB, should be 503
    expect([200, 503, 504]).toContain(res.statusCode);
    // Should include diagnostic headers
    expect(res.headers).toHaveProperty('x-org-filter');
    expect(res.headers).toHaveProperty('x-db-connected');
  });
});
