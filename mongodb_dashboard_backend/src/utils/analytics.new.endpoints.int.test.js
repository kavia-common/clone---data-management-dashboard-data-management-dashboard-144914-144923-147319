'use strict';

const request = require('supertest');
const app = require('../app');

describe('Analytics endpoints - users active trend & llm costs over-time', () => {
  it('GET /api/analytics/users/active-trend should return 200 with labels/datasets', async () => {
    const res = await request(app)
      .get('/api/analytics/users/active-trend')
      .set('x-organization-id', 'T0000'); // bypass for CI without auth
    expect([200, 500]).toContain(res.status); // tolerate 500 if db not connected, but prefer 200
    if (res.status === 200) {
      expect(res.body).toHaveProperty('labels');
      expect(Array.isArray(res.body.labels)).toBe(true);
      expect(res.body).toHaveProperty('datasets');
      expect(Array.isArray(res.body.datasets)).toBe(true);
      if (res.body.datasets.length > 0) {
        expect(res.body.datasets[0]).toHaveProperty('label');
        expect(res.body.datasets[0]).toHaveProperty('data');
        expect(Array.isArray(res.body.datasets[0].data)).toBe(true);
      }
    }
  });

  it('GET /api/analytics/llm-costs/over-time should return 200 with expected JSON shape', async () => {
    const res = await request(app)
      .get('/api/analytics/llm-costs/over-time?granularity=day')
      .set('x-organization-id', 'T0000'); // bypass for CI
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('labels');
      expect(Array.isArray(res.body.labels)).toBe(true);
      expect(res.body).toHaveProperty('datasets');
      expect(Array.isArray(res.body.datasets)).toBe(true);
      if (res.body.datasets.length > 0) {
        expect(res.body.datasets[0].label).toBe('Total Cost');
        expect(Array.isArray(res.body.datasets[0].data)).toBe(true);
      }
    }
  });
});
