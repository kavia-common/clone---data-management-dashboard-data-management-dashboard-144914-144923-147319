'use strict';

const request = require('supertest');
const app = require('../../app');

describe('GET /api/llm-costs (hyphen) route', () => {
  it('responds 200 with envelope fields using fallback controller', async () => {
    const res = await request(app)
      .get('/api/llm-costs')
      .query({ page: 1, limit: 1 })
      .set('x-organization-id', 'test-tenant');

    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(res.body).toHaveProperty('success', true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('meta');
    expect(res.headers).toHaveProperty('x-effective-tenant', 'test-tenant');
  });
});
