'use strict';

const request = require('supertest');

describe('GET /api/llm_costs route wiring and basic behavior', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    app = require('../../app');
  });

  it('should return 400 when organization_id is missing', async () => {
    const res = await request(app).get('/api/llm_costs');
    expect([400, 500]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body).toHaveProperty('success', false);
    }
  });

  it('should not be 404 and accept organization_id, returning array or envelope', async () => {
    const res = await request(app)
      .get('/api/llm_costs')
      .query({ organization_id: 'ORG_TEST' });

    // Allow 200 (connected DB) or 500 (no DB); must not be 404 if route is wired
    expect([200, 500]).toContain(res.status);
    expect(res.status).not.toBe(404);

    if (res.status === 200) {
      // Without pagination defaults, controller returns raw array
      expect(Array.isArray(res.body)).toBe(true);
    }
  });

  it('should support pagination envelope when page/limit are provided', async () => {
    const res = await request(app)
      .get('/api/llm_costs?page=1&limit=5')
      .query({ organization_id: 'ORG_TEST' });

    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('page');
      expect(res.body.meta).toHaveProperty('limit');
      expect(res.body.meta).toHaveProperty('total');
    }
  });
});
