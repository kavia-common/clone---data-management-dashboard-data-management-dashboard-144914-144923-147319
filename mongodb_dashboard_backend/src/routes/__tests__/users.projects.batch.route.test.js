'use strict';

const request = require('supertest');

// Mock getDb so we can validate the aggregation pipeline and response shaping without a real DB.
jest.mock('../../config/db', () => ({
  getDb: jest.fn(),
}));

const { getDb } = require('../../config/db');
const app = require('../../app');

describe('POST /api/users/projects (batch) - sessions by user aggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when userIds is not an array', async () => {
    const res = await request(app)
      .post('/api/users/projects')
      .send({ userIds: 'not-array', organization_id: 'T0015' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userIds must be an array/i);
  });

  it('returns 400 when organization_id is missing (non-T0000)', async () => {
    const res = await request(app).post('/api/users/projects').send({ userIds: ['u1', 'u2'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/organization_id/i);
  });

  it('returns success with empty map when no userIds provided (empty array)', async () => {
    const res = await request(app).post('/api/users/projects').send({ userIds: [], organization_id: 'T0015' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({});
  });

  it('aggregates total sessions per user for a normal tenant (T0015) using created_at inclusive bounds, and returns 0 for missing users', async () => {
    const aggregate = jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue([
        { user_id: 'u1', user_name: 'Alice', total_count: 3 },
        { user_id: 'u2', user_name: null, total_count: 1 },
      ]),
    }));

    getDb.mockResolvedValue({
      collection: () => ({ aggregate }),
    });

    const from = '2025-01-01T00:00:00.000Z';
    const to = '2025-01-31T23:59:59.999Z';

    const res = await request(app).post('/api/users/projects').send({
      organization_id: 'T0015',
      userIds: ['u1', 'u2', 'u3'],
      from,
      to,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tenant_id).toBe('T0015');

    // Uniform per-user structure with projects: [] and total_count from sessions count
    expect(res.body.data).toEqual({
      u1: { user_id: 'u1', user_name: 'Alice', total_count: 3, projects: [] },
      u2: { user_id: 'u2', user_name: null, total_count: 1, projects: [] },
      u3: { user_id: 'u3', user_name: null, total_count: 0, projects: [] },
    });

    // Validate pipeline structure and match semantics
    expect(aggregate).toHaveBeenCalledTimes(1);
    const pipeline = aggregate.mock.calls[0][0];
    expect(Array.isArray(pipeline)).toBe(true);

    const matchStage = pipeline[0].$match;
    const matchJson = JSON.stringify(matchStage);

    // created_at bounds inclusive
    expect(matchJson).toMatch(/created_at/);
    expect(matchJson).toMatch(/\\$gte/);
    expect(matchJson).toMatch(/\\$lte/);

    // user filter
    expect(matchJson).toMatch(/\\$expr/);
    expect(matchJson).toMatch(/user_id/);

    // tenant scoping present for non-T0000 tenant
    expect(matchJson).toMatch(/tenant_id/);
    expect(matchJson).toMatch(/organization_id/);
  });

  it('returns 413 when userIds exceeds configured max', async () => {
    const big = Array.from({ length: 6000 }, (_, i) => `u${i}`);
    const res = await request(app).post('/api/users/projects').send({ userIds: big, organization_id: 'T0000' });
    // default max is 5000 in route (env overrideable)
    expect(res.status).toBe(413);
  });
});
