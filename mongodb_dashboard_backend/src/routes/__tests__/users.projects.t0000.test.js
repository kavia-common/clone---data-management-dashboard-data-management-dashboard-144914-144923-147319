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

    const res = await request(app).get('/api/users/u123/projects').query({ organization_id: 't0000' });

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
    SessionTracking.aggregate.mockResolvedValue([{ project_id: 'p3', last_activity: new Date('2025-02-01T00:00:00.000Z') }]);
    SessionTracking.countDocuments.mockResolvedValue(2);

    // Mock as a direct array return (no .lean()) to ensure service is resilient.
    Project.find.mockResolvedValue([{ project_id: 'p3', project_name: 'Tenant Project' }]);

    const res = await request(app).get('/api/users/u123/projects').query({ organization_id: 'ORG_1' });

    expect(res.status).toBe(200);
    expect(SessionTracking.aggregate).toHaveBeenCalledTimes(1);
    expect(SessionTracking.countDocuments).toHaveBeenCalledTimes(1);

    const pipeline = SessionTracking.aggregate.mock.calls[0][0];
    const match = pipeline[0].$match;

    // In tenant-scoped mode, match is composed under $and to avoid overwriting multiple $or clauses.
    expect(match).toHaveProperty('$and');
    expect(Array.isArray(match.$and)).toBe(true);

    const serializedMatch = JSON.stringify(match);
    // Ensure user scoping and tenant alias scoping are both present.
    // JSON.stringify contains "$expr" literally, so the correct regex is /\$expr/.
    expect(serializedMatch).toMatch(/\$expr/);
    expect(serializedMatch).toMatch(/tenant_id/);
    expect(serializedMatch).toMatch(/organization_id/);
    expect(serializedMatch).toMatch(/organizationId/);

    // Project name lookup is tenant-scoped in non-T0000 mode
    const projectFindFilter = Project.find.mock.calls[0][0];
    expect(projectFindFilter).toHaveProperty('$or');

    expect(res.body).toHaveProperty('tenant_id', 'ORG_1');
    expect(res.body).toHaveProperty('total_count', 2);
    expect(res.body.projects[0].project_id).toBe('p3');
  });

  it('applies from/to across timestamp + session_start + last_updated for both distinct projects and sessions count', async () => {
    SessionTracking.aggregate.mockResolvedValue([{ project_id: 'p1', last_activity: new Date('2025-01-05T00:00:00.000Z') }]);
    SessionTracking.countDocuments.mockResolvedValue(3);
    Project.find.mockResolvedValue([{ project_id: 'p1', project_name: 'Project One' }]);

    const res = await request(app).get('/api/users/u123/projects').query({
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

    // Match is composed under $and; ensure both user scoping and time scoping exist.
    expect(match).toHaveProperty('$and');
    const matchJson = JSON.stringify(match);
    expect(matchJson).toMatch(/\$expr/);

    // Time window must be applied (any of these fields in range).
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
    SessionTracking.aggregate.mockResolvedValue([{ project_id: 'p1', last_activity: new Date('2025-01-02T00:00:00.000Z') }]);
    SessionTracking.countDocuments.mockResolvedValue(1);
    Project.find.mockResolvedValue([{ project_id: 'p1', project_name: 'Project One' }]);

    const res = await request(app).get('/api/users/u123/projects').query({
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

  it('filters projects strictly to activity inside [from,to] (Today vs Yesterday) and does not widen during enrichment', async () => {
    /**
     * Seed behavior (mocked):
     * - "today" has activity only for p_today
     * - "yesterday" has activity only for p_yday
     *
     * Endpoint must:
     * - return projects.length = 1 for each window
     * - flip which project is returned depending on window
     * - ensure Project.find lookup only uses returned project_ids (no re-expansion)
     */
    const tenantId = 'ORG_1';
    const userId = 'u123';

    const todayFrom = '2025-01-02T00:00:00.000Z';
    const todayTo = '2025-01-02T23:59:59.999Z';
    const ydayFrom = '2025-01-01T00:00:00.000Z';
    const ydayTo = '2025-01-01T23:59:59.999Z';

    // ---- Today window ----
    SessionTracking.aggregate.mockResolvedValueOnce([{ project_id: 'p_today', last_activity: new Date(todayTo) }]);
    SessionTracking.countDocuments.mockResolvedValueOnce(5);

    // Ensure enrichment does not widen: should only look up p_today.
    Project.find.mockResolvedValueOnce([{ project_id: 'p_today', project_name: 'Today Project' }]);

    const resToday = await request(app)
      .get(`/api/users/${userId}/projects`)
      .query({ organization_id: tenantId, from: todayFrom, to: todayTo });

    expect(resToday.status).toBe(200);
    expect(Array.isArray(resToday.body.projects)).toBe(true);
    expect(resToday.body.projects).toHaveLength(1);
    expect(resToday.body.projects[0].project_id).toBe('p_today');
    expect(resToday.body).toHaveProperty('total_count', 5);

    const todayProjectFindFilter = Project.find.mock.calls[0][0];
    expect(todayProjectFindFilter).toHaveProperty('project_id');
    expect(todayProjectFindFilter.project_id).toHaveProperty('$in');
    expect(todayProjectFindFilter.project_id.$in).toEqual(['p_today']);

    // ---- Yesterday window (use ISODate wrapper to validate parsing) ----
    SessionTracking.aggregate.mockResolvedValueOnce([{ project_id: 'p_yday', last_activity: new Date(ydayTo) }]);
    SessionTracking.countDocuments.mockResolvedValueOnce(2);

    // Ensure enrichment does not widen: should only look up p_yday.
    Project.find.mockResolvedValueOnce([{ project_id: 'p_yday', project_name: 'Yesterday Project' }]);

    const resYday = await request(app).get(`/api/users/${userId}/projects`).query({
      organization_id: tenantId,
      from: `ISODate("${ydayFrom}")`,
      to: ydayTo,
    });

    expect(resYday.status).toBe(200);
    expect(Array.isArray(resYday.body.projects)).toBe(true);
    expect(resYday.body.projects).toHaveLength(1);
    expect(resYday.body.projects[0].project_id).toBe('p_yday');
    expect(resYday.body).toHaveProperty('total_count', 2);

    // Project.find was called twice total in this test; verify the 2nd call is scoped to p_yday only.
    const ydayProjectFindFilter = Project.find.mock.calls[1][0];
    expect(ydayProjectFindFilter).toHaveProperty('project_id');
    expect(ydayProjectFindFilter.project_id).toHaveProperty('$in');
    expect(ydayProjectFindFilter.project_id.$in).toEqual(['p_yday']);
  });
});
