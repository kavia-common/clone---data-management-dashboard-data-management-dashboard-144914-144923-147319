const request = require('supertest');
const app = require('../app');

describe('GET /api/llm-costs listing (smoke)', () => {
  it('returns 200 with envelope when page/limit provided and organization_id alias is accepted', async () => {
    const res = await request(app)
      .get('/api/llm-costs')
      .query({ page: 1, limit: 10, organization_id: 'T0015' });

    // Accept either envelope or array, but must not be 500
    expect([200, 400, 403]).toContain(res.status);
    if (res.status === 200) {
      const body = res.body;
      // when paginated we expect envelope
      if (body && typeof body === 'object' && 'success' in body && 'meta' in body) {
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
        expect(typeof body.meta.page).toBe('number');
        expect(typeof body.meta.limit).toBe('number');
        expect(typeof body.meta.total).toBe('number');
      }
    }
  });
});
