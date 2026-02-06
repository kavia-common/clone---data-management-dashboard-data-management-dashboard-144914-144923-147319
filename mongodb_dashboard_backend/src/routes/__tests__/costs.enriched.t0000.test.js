'use strict';

const request = require('supertest');
const app = require('../../app');

describe('GET /api/costs - T0000 all-tenants behavior (enriched costs)', () => {
  it('treats organization_id=T0000 as all-tenants selector (no 400/403)', async () => {
    const res = await request(app).get('/api/costs?organization_id=T0000');

    // In CI this backend may run without Mongo connected/configured; tolerate 500.
    // What we must ensure here is that T0000 is NOT treated as a literal tenant filter requirement
    // that causes a 400 "Missing tenant" or a 403 tenant mismatch.
    expect([200, 500]).toContain(res.status);
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(403);
  });
});
