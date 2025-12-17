'use strict';

const request = require('supertest');
const app = require('../../app');

describe('GET /api/costs (enriched)', () => {
  it('should respond 200 with envelope and include data array', async () => {
    const res = await request(app)
      .get('/api/costs')
      .set('x-organization-id', 'test-tenant')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body).toBeDefined();
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);

    // If data exists, ensure objects are returned and user_name field is present (may be Unknown User)
    if (res.body.data.length > 0) {
      const item = res.body.data[0];
      expect(typeof item).toBe('object');
      expect(item).toHaveProperty('user_name');
    }

    // Headers should include effective tenant and pagination hints
    expect(res.headers['x-effective-tenant']).toBeDefined();
    expect(res.headers['x-costs-limit']).toBeDefined();
    expect(res.headers['x-costs-page']).toBeDefined();
  });
});
