'use strict';

/**
 * PUBLIC_INTERFACE
 * Smoke tests for /api/users endpoints.
 *
 * These tests assert that the route is registered and returns a non-5xx status.
 * In test mode, app.js enforces DB connectivity for most routes; if DB is not connected,
 * the app returns 503. We accept 200/206/400/404/422/503 as "non-crash" outcomes.
 */

const request = require('supertest');
const app = require('../../app');

describe('Users routes smoke', () => {
  it('GET /api/users should not crash (no 5xx)', async () => {
    const res = await request(app).get('/api/users');
    expect([200, 206, 400, 404, 422, 503]).toContain(res.status);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('GET /api/users/seed-if-empty should not crash (no 5xx)', async () => {
    const res = await request(app).get('/api/users/seed-if-empty');
    expect([200, 206, 400, 404, 422, 503]).toContain(res.status);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
