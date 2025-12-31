'use strict';

const request = require('supertest');

// Mock models used by the endpoint/service so the test is stable without MongoDB.
jest.mock('../../models/sessionTracking.model', () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock('../../models/project.model', () => ({
  find: jest.fn(),
}));

const SessionTracking = require('../../models/sessionTracking.model');
const Project = require('../../models/project.model');
const app = require('../../app');

describe('GET /api/users/:userId/projects - T0000 all-tenants aggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('when organization_id=T0000 (case-insensitive), aggregates across all tenants (no tenant filter)', async () => {
    SessionTracking.aggregate.mockResolvedValue([
      { project_id: 'p1', last_activity: new Date('2025-01-02T00:00:00.000Z') },
      { project_id: 'p2', last_activity: new Date('2025-01-03T00:00:00.000Z') },
    ]);
    SessionTracking.countDocuments.mockResolvedValue(7);

    // In T0000 mode, project name lookup should NOT be tenant-scoped.
    // Mock as a direct array return (no .lean()) to ensure service is resilient.
    Project.find.mockResolvedValue([{ project_id: 'p1', project_name: 'Project One' }]);

    const res = await request(app)
      .get('/api/users/u123/projects')
      .query({ organization_id: 't0000' });

    expect(res.status).toBe(200);
    expect(SessionTracking.aggregate).toHaveBeenCalledTimes(1);
    expect(SessionTracking.countDocuments).toHaveBeenCalledTimes(1);

    // Verify the aggregation call does NOT contain a tenant $or when in bypass mode.
    const pipeline = SessionTracking.aggregate.mock.calls[0][0];
    expect(Array.isArray(pipeline)).toBe(true);
    expect(pipeline[0]).toHaveProperty('$match');
    expect(pipeline[0].$match).not.toHaveProperty('$or');

    // Verify countDocuments filter does NOT contain a tenant $or when in bypass mode.
    const countFilter = SessionTracking.countDocuments.mock.calls[0][0];
    expect(countFilter).not.toHaveProperty('$or');

    // Verify project names query is not tenant-scoped in T0000 mode.
    const projectFindFilter = Project.find.mock.calls[0][0];
    expect(projectFindFilter).toHaveProperty('project_id');
    expect(projectFindFilter).not.toHaveProperty('$or');

    // Response shape compatibility
    expect(res.body).toHaveProperty('user_id', 'u123');
    expect(res.body).toHaveProperty('tenant_id');
    expect(String(res.body.tenant_id).toUpperCase()).toBe('T0000');
    expect(Array.isArray(res.body.projects)).toBe(true);
    expect(res.body).toHaveProperty('total_count', 7);

    // Ensure projects are returned and name is attached when available
    const p1 = res.body.projects.find((p) => p.project_id === 'p1');
    expect(p1).toBeTruthy();
    expect(p1.project_name).toBe('Project One');
  });

  it('when organization_id is a specific tenant, remains tenant-scoped using alias fields', async () => {
    SessionTracking.aggregate.mockResolvedValue([
      { project_id: 'p3', last_activity: new Date('2025-02-01T00:00:00.000Z') },
    ]);
    SessionTracking.countDocuments.mockResolvedValue(2);

    // Mock as a direct array return (no .lean()) to ensure service is resilient.
    Project.find.mockResolvedValue([{ project_id: 'p3', project_name: 'Tenant Project' }]);

    const res = await request(app)
      .get('/api/users/u123/projects')
      .query({ organization_id: 'ORG_1' });

    expect(res.status).toBe(200);
    expect(SessionTracking.aggregate).toHaveBeenCalledTimes(1);
    expect(SessionTracking.countDocuments).toHaveBeenCalledTimes(1);

    const pipeline = SessionTracking.aggregate.mock.calls[0][0];
    const match = pipeline[0].$match;

    // In tenant-scoped mode, $or across aliases must be present
    expect(match).toHaveProperty('$or');
    expect(Array.isArray(match.$or)).toBe(true);
    expect(match.$or.some((c) => c.tenant_id === 'ORG_1')).toBe(true);
    expect(match.$or.some((c) => c.organization_id === 'ORG_1')).toBe(true);
    expect(match.$or.some((c) => c.organizationId === 'ORG_1')).toBe(true);

    // Project name lookup is tenant-scoped in non-T0000 mode
    const projectFindFilter = Project.find.mock.calls[0][0];
    expect(projectFindFilter).toHaveProperty('$or');

    expect(res.body).toHaveProperty('tenant_id', 'ORG_1');
    expect(res.body).toHaveProperty('total_count', 2);
    expect(res.body.projects[0].project_id).toBe('p3');
  });

  it('applies from/to across timestamp + session_start + last_updated for both distinct projects and sessions count', async () => {
    SessionTracking.aggregate.mockResolvedValue([
      { project_id: 'p1', last_activity: new Date('2025-01-05T00:00:00.000Z') },
    ]);
    SessionTracking.countDocuments.mockResolvedValue(3);
    Project.find.mockResolvedValue([{ project_id: 'p1', project_name: 'Project One' }]);

    const res = await request(app)
      .get('/api/users/u123/projects')
      .query({
        organization_id: 'ORG_1',
        // These are already full ISO strings (no ISODate wrapper)
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-07T23:59:59.999Z',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_count', 3);

    // 1) Verify aggregation $match includes time constraints somewhere in its match JSON.
    // (Service-side aggregation composition differs from route-side count composition.)
    const pipeline = SessionTracking.aggregate.mock.calls[0][0];
    const match = pipeline[0].$match;
    expect(match).toHaveProperty('$expr');
    const matchJson = JSON.stringify(match);
    expect(matchJson).toMatch(/timestamp/);
    expect(matchJson).toMatch(/session_start/);
    expect(matchJson).toMatch(/last_updated/);

    // 2) Verify countDocuments uses *both* time + tenant scoping (without overwriting).
    const countFilter = SessionTracking.countDocuments.mock.calls[0][0];
    // After the fix, the route composes filters under $and to preserve multiple $or clauses.
    expect(countFilter).toHaveProperty('$and');
    expect(Array.isArray(countFilter.$and)).toBe(true);

    const serialized = JSON.stringify(countFilter);
    // time range must be present
    expect(serialized).toMatch(/timestamp/);
    expect(serialized).toMatch(/session_start/);
    expect(serialized).toMatch(/last_updated/);
    expect(serialized).toMatch(/\$gte/);
    expect(serialized).toMatch(/\$lte/);

    // tenant scoping must also be present
    expect(serialized).toMatch(/tenant_id/);
    expect(serialized).toMatch(/organization_id/);
  });

  it('normalizes ISODate("...") wrapper and plain ISO strings consistently (date range propagates to countDocuments)', async () => {
    SessionTracking.aggregate.mockResolvedValue([
      { project_id: 'p1', last_activity: new Date('2025-01-02T00:00:00.000Z') },
    ]);
    SessionTracking.countDocuments.mockResolvedValue(1);
    Project.find.mockResolvedValue([{ project_id: 'p1', project_name: 'Project One' }]);

    const res = await request(app)
      .get('/api/users/u123/projects')
      .query({
        organization_id: 'ORG_1',
        from: 'ISODate("2025-01-01T00:00:00.000Z")',
        to: '2025-01-03T23:59:59.999Z',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_count', 1);

    const countFilter = SessionTracking.countDocuments.mock.calls[0][0];
    const serialized = JSON.stringify(countFilter);

    // Date normalization must result in a real range query
    expect(serialized).toMatch(/\$gte/);
    expect(serialized).toMatch(/\$lte/);
  });
});
