'use strict';

/**
 * PUBLIC_INTERFACE
 * Basic smoke tests for /api/llm-costs ensuring response is fast and shaped correctly with diagnostics defaulting to false.
 */
const request = require('supertest');
const app = require('../app');

describe('GET /api/llm-costs performance smoke', () => {
  it('returns data envelope with diagnostics omitted by default', async () => {
    const res = await request(app)
      .get('/api/llm-costs?page=1&limit=10&organization_id=T0015')
      .set('x-organization-id', 'T0015')
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('limit');
    // diagnostics should be undefined or omitted by default
    expect(res.body.meta.diagnostics).toBeUndefined();

    // timing headers should exist
    expect(res.headers).toHaveProperty('x-llm-timing-parsed-ms');
    expect(res.headers).toHaveProperty('x-llm-timing-built-ms');
    expect(res.headers).toHaveProperty('x-llm-timing-exec-ms');
  });
});
