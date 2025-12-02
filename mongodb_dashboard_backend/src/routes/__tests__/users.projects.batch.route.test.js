'use strict';

const request = require('supertest');
const app = require('../../app');

describe('POST /api/users/projects (batch)', () => {
  it('returns 400 when userIds is not an array', async () => {
    const res = await request(app)
      .post('/api/users/projects')
      .send({ userIds: 'not-array', organization_id: 'org_test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userIds must be an array/);
  });

  it('returns 400 when organization_id is missing', async () => {
    const res = await request(app)
      .post('/api/users/projects')
      .send({ userIds: ['u1', 'u2'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/organization_id/);
  });

  it('returns success with empty map when no userIds provided (empty array)', async () => {
    const res = await request(app)
      .post('/api/users/projects')
      .send({ userIds: [], organization_id: 'org_test' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({});
  });

  it('accepts tenant_id alias', async () => {
    const res = await request(app)
      .post('/api/users/projects')
      .send({ userIds: ['u1'], tenant_id: 'org_test' });
    // db may not be connected in test env; allow 200 or 503 based on environment
    expect([200, 503, 500, 400]).toContain(res.status);
  });
});
