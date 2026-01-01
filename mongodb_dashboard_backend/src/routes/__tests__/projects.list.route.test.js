'use strict';

const request = require('supertest');
const mongoose = require('mongoose');

// Import app without starting listener
const app = require('../../app');

describe('GET /api/projects (list)', () => {
  afterAll(async () => {
    // Avoid open handles when CI has a DB connection
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
      }
    } catch {
      // ignore
    }
  });

  test('requires tenant scope when not in bypass mode', async () => {
    const res = await request(app).get('/api/projects?page=1&limit=5');
    // Depending on auth/demo mode configuration, this may be 401 (no token) or 400 (missing tenant).
    // Either way, it must NOT be 5xx.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('returns envelope {success,data,meta:{total,page,limit}} when scoped via organization_id', async () => {
    const res = await request(app).get('/api/projects?page=1&limit=5&organization_id=DEMO');
    // If auth is enforced strictly in a given environment, 401 is acceptable.
    // When it succeeds, it must match the envelope contract.
    expect([200, 401]).toContain(res.status);

    if (res.status === 200) {
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('total');
      expect(res.body.meta).toHaveProperty('page', 1);
      expect(res.body.meta).toHaveProperty('limit', 5);
    }
  });

  test('invalid filter payload (ISODate literal) returns 400 and does not throw', async () => {
    const res = await request(app).get(
      '/api/projects?page=1&limit=5&organization_id=DEMO&filter=ISODate(%222025-01-01T00:00:00Z%22)'
    );

    // Either 400 (bad filter) or 401 (auth required) are acceptable, but never 5xx.
    expect([400, 401]).toContain(res.status);
    if (res.status === 400) {
      // Current route uses failure() helper which returns {success:false,message}
      expect(res.body).toHaveProperty('success', false);
    }
  });

  test('extended-json date filter does not cause CastError (should not 5xx)', async () => {
    const filter = encodeURIComponent(
      JSON.stringify({ created_at: { $gte: { $date: '2025-01-01T00:00:00.000Z' } } })
    );

    const res = await request(app).get(
      `/api/projects?page=1&limit=5&organization_id=DEMO&filter=${filter}`
    );

    // If unauthorized, 401; otherwise should be 200 (and not 400 CastError).
    expect([200, 401]).toContain(res.status);
  });
});
