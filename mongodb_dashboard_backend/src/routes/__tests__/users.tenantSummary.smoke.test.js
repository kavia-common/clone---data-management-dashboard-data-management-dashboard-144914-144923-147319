'use strict';

const request = require('supertest');
const app = require('../../app');

describe('GET /api/users/tenant-summary', () => {
  it('should respond with 200 and an array of { tenant, count } (or 503 if DB disconnected)', async () => {
    const res = await request(app).get('/api/users/tenant-summary')
      .query({ from: '2025-09-30T05:14:20.507Z', to: '2025-10-30T05:14:20.507Z', status: 'completed|active', includeInactive: 'false' });

    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        const item = res.body[0];
        expect(item).toHaveProperty('tenant');
        expect(item).toHaveProperty('count');
        expect(typeof item.tenant === 'string').toBe(true);
        expect(typeof item.count === 'number').toBe(true);
      }
    }
  });
});
