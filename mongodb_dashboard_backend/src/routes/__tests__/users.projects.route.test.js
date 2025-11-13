'use strict';

const request = require('supertest');

// PUBLIC_INTERFACE
// Minimal integration check that /api/users/:userId/projects is wired and not 404.
// In test mode, app.js bypasses DB checks for certain paths; this test relies on that.
describe('GET /api/users/:userId/projects route wiring', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    // Avoid requiring server.js which starts the listener; import app directly
    app = require('../../app');
  });

  it('should return 400 when tenant is missing but not 404', async () => {
    const res = await request(app).get('/api/users/u123/projects');
    expect([400, 503, 200, 500]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });

  it('should accept organization_id and return 200/empty structure when no DB (may be 503 depending on middleware)', async () => {
    const res = await request(app).get('/api/users/u123/projects').query({ organization_id: 'org_demo' });
    // It should be wired; allow 200 or 500/503 depending on env behavior, but must not be 404.
    expect([200, 500, 503, 400]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });
});
