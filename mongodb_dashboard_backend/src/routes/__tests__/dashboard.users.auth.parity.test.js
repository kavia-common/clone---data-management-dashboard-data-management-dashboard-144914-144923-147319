'use strict';

const request = require('supertest');
const app = require('../../app');

/**
 * PUBLIC_INTERFACE
 * Auth parity tests for GET /api/dashboard/users
 *
 * Goal:
 * - Ensure this endpoint is protected using the same auth middleware patterns as other protected routes.
 * - Validate that missing/invalid tokens yield 401.
 * - Validate that a request with Authorization: Bearer <token> passes the auth gate (i.e., not 401).
 *
 * Notes:
 * - These tests are intentionally DB-independent. When DB is not connected in test env, the
 *   endpoint may return 503 after auth passes; that's acceptable here because we are validating
 *   authentication parity only.
 * - verifyAuth in this codebase supports a dev/demo token "ok" in non-production when no JWT secret
 *   is configured; we reuse that behavior to assert the auth gate passes.
 */
describe('GET /api/dashboard/users auth parity', () => {
  test('401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/dashboard/users');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
      })
    );
  });

  test('401 when Authorization header is invalid', async () => {
    const res = await request(app)
      .get('/api/dashboard/users')
      .set('Authorization', 'Bearer definitely-invalid-token')
      .set('x-organization-id', 'DEMO');

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

    // DB may be disconnected in test env, but auth should pass.
    expect(res.status).not.toBe(401);
  });
});
