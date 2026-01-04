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

  it('when organization_id=T0000, does NOT apply tenant/org filter but still applies userIds + date range', async () => {
    const aggregate = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) }));
    getDb.mockResolvedValue({ collection: () => ({ aggregate }) });

    const res = await request(app)
      .post('/api/users/projects')
      .send({
        organization_id: 'T0000',
        userIds: ['u1', 'u2'],
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-31T23:59:59.999Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tenant_id).toBe('T0000');
    expect(res.body.data).toEqual({
      u1: { total_count: 0, projects: [] },
      u2: { total_count: 0, projects: [] },
    });

    // Validate pipeline $match for the single chunk used in this test
    expect(aggregate).toHaveBeenCalledTimes(1);
    const pipeline = aggregate.mock.calls[0][0];
    expect(Array.isArray(pipeline)).toBe(true);

    const matchStage = pipeline[0].$match;
    const matchJson = JSON.stringify(matchStage);

    // Must include userIds filter
    expect(matchJson).toMatch(/\$expr/);
    expect(matchJson).toMatch(/user_id/);

    // Must include time filter (last_updated or session_start)
    expect(matchJson).toMatch(/last_updated/);
    expect(matchJson).toMatch(/session_start/);

    // Must NOT include tenant/org filter
    expect(matchJson).not.toMatch(/tenant_id/);
    expect(matchJson).not.toMatch(/organization_id/);
  });

  it('when organization_id is normal tenant, includes tenant/org filter and still applies userIds', async () => {
    const aggregate = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) }));
    getDb.mockResolvedValue({ collection: () => ({ aggregate }) });

    const res = await request(app)
      .post('/api/users/projects')
      .send({
        organization_id: 'ORG_1',
        userIds: ['u1'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const pipeline = aggregate.mock.calls[0][0];
    const matchStage = pipeline[0].$match;
    const matchJson = JSON.stringify(matchStage);

    expect(matchJson).toMatch(/\$expr/);
    expect(matchJson).toMatch(/tenant_id/);
    expect(matchJson).toMatch(/organization_id/);
  });
});
