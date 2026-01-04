'use strict';

const request = require('supertest');

// Mock getDb so we can validate the aggregation pipeline without a real DB connection.
jest.mock('../../config/db', () => ({
  getDb: jest.fn(),
}));

const { getDb } = require('../../config/db');
const app = require('../../app');

describe('POST /api/users/projects (batch) - T0000 all-tenants wildcard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('when organization_id=T0000, does NOT apply tenant/org filter but applies userIds + created_at $gte/$lte', async () => {
    const aggregate = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) }));
    getDb.mockResolvedValue({ collection: () => ({ aggregate }) });

    const res = await request(app).post('/api/users/projects').send({
      organization_id: 'T0000',
      userIds: ['u1', 'u2'],
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-31T23:59:59.999Z',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tenant_id).toBe('T0000');
    expect(res.body.data).toEqual({
      u1: { user_id: 'u1', user_name: null, total_count: 0, projects: [] },
      u2: { user_id: 'u2', user_name: null, total_count: 0, projects: [] },
    });

    // Validate pipeline $match for the single chunk used in this test
    expect(aggregate).toHaveBeenCalledTimes(1);
    const pipeline = aggregate.mock.calls[0][0];
    expect(Array.isArray(pipeline)).toBe(true);

    const matchStage = pipeline[0].$match;
    const matchJson = JSON.stringify(matchStage);

    // Must include userIds filter
    expect(matchJson).toMatch(/\\$expr/);
    expect(matchJson).toMatch(/user_id/);

    // Must include time filter on created_at with inclusive bounds
    expect(matchJson).toMatch(/created_at/);
    expect(matchJson).toMatch(/\\$gte/);
    expect(matchJson).toMatch(/\\$lte/);

    // Must NOT include tenant/org filter
    expect(matchJson).not.toMatch(/\"tenant_id\"/);
    expect(matchJson).not.toMatch(/\"organization_id\"/);
  });

  it('inclusive boundaries: sessions exactly at from/to should be counted (pipeline uses $gte/$lte)', async () => {
    // We validate inclusivity by ensuring the query uses $gte and $lte; counting correctness is DB behavior.
    const aggregate = jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue([{ user_id: 'u1', user_name: 'Edge', total_count: 2 }]),
    }));
    getDb.mockResolvedValue({ collection: () => ({ aggregate }) });

    const from = '2025-02-01T00:00:00.000Z';
    const to = '2025-02-01T23:59:59.999Z';

    const res = await request(app).post('/api/users/projects').send({
      organization_id: 'T0000',
      userIds: ['u1'],
      from,
      to,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.u1.total_count).toBe(2);

    const pipeline = aggregate.mock.calls[0][0];
    const matchJson = JSON.stringify(pipeline[0].$match);
    expect(matchJson).toMatch(/\\$gte/);
    expect(matchJson).toMatch(/\\$lte/);
  });
});
