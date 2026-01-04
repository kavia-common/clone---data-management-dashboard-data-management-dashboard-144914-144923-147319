'use strict';

const request = require('supertest');
const app = require('../../app');

/**
 * PUBLIC_INTERFACE
 * Regression tests for GET /api/dashboard/users authentication gate.
 *
 * Notes:
 * - We do NOT require a DB connection for these tests.
 * - In test env, the route may return 503 ("Database not connected") after passing auth,
 *   but it must not return 401 when a Bearer token is provided.
 */
describe('GET /api/dashboard/users auth gate', () => {
  test('401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/dashboard/users');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
      })
    );
  });

  test('passes auth gate with Bearer ok (not 401)', async () => {
    const res = await request(app)
      .get('/api/dashboard/users')
      .set('Authorization', 'Bearer ok')
      .set('x-organization-id', 'DEMO');

    // In NODE_ENV=test, verifyAuth supports demo token "ok" (when secret is not configured).
    // Downstream may return 503 if DB is disconnected; this test is only about auth gating.
    expect(res.status).not.toBe(401);
  });
});
