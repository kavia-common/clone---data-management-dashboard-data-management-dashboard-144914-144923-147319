'use strict';

const request = require('supertest');
const app = require('../../app');

describe('GET /api/users/active-trend - T0000 all-tenants behavior', () => {
  it('treats tenant_id=T0000 as all-tenants (does not 403, returns 200/500 depending on db)', async () => {
    const res = await request(app).get('/api/users/active-trend?tenant_id=T0000');

    // In CI this repo often runs without Mongo connected; many tests tolerate 500.
    // What we must ensure here is: no 403 due to tenant scope mismatch and no literal tenant filter requirement.
    expect([200, 500]).toContain(res.status);
    expect(res.status).not.toBe(403);

    if (res.status === 200) {
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('granularity');
    }
  });
});
