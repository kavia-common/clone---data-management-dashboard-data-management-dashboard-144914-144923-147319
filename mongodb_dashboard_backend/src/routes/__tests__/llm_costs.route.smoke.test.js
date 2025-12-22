'use strict';

const request = require('supertest');
const app = require('../../app');

describe('GET /api/llm_costs (underscore) route', () => {
  it('responds 200 with envelope fields even when DB is not connected', async () => {
    const res = await request(app)
      .get('/api/llm_costs')
      .query({ page: 1, limit: 1 }) // force envelope pagination
      .set('x-organization-id', 'test-tenant');

    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(typeof res.body).toBe('object');
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('limit');
    expect(res.body.meta).toHaveProperty('total');
  });
});
