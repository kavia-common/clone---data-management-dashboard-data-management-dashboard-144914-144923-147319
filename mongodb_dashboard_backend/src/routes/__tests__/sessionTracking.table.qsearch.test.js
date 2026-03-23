'use strict';

const express = require('express');
const request = require('supertest');

// Mock the SessionTracking model used by the route so we can inspect the generated filter.
jest.mock('../../models/sessionTracking.model', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

const SessionTracking = require('../../models/sessionTracking.model');

function makeApp() {
  const app = express();
  // Mount exactly the same router used by /api/session-tracking/table.
  // The table router is only a re-export of sessionTracking.routes.
  // We test via the table path to reflect the real failing endpoint.
  const tableRouter = require('../sessionTracking.table.routes');
  app.use('/api/session-tracking/table', tableRouter);
  return app;
}

describe('GET /api/session-tracking/table q-search', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('q search matches ONLY exact User_name and respects tenant_id scoping', async () => {
    // Arrange: return one matching doc.
    const docs = [{ _id: '1', User_name: 'Sumi P', tenant_id: 'TENANT_X' }];

    // Provide chainable query builder for find().sort().skip().limit().lean()
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docs),
    };

    SessionTracking.find.mockReturnValue(chain);
    SessionTracking.countDocuments.mockResolvedValue(1);

    const app = makeApp();

    // Act (non-bypass tenant)
    const res = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q: 'Sumi P', tenant_id: 'TENANT_X' })
      .expect(200);

    // Assert payload
    expect(res.body).toEqual({
      success: true,
      data: docs,
      meta: { page: 1, limit: 10, total: 1 },
    });

    // Assert generated filter:
    // { $and: [ { User_name:'Sumi P' }, { $or:[{tenant_id:'TENANT_X'}, ...] } ] }
    const filterArg = SessionTracking.find.mock.calls[0][0];
    expect(filterArg).toHaveProperty('$and');
    expect(Array.isArray(filterArg.$and)).toBe(true);

    const userNamePart = filterArg.$and.find((p) => p && p.User_name === 'Sumi P');
    expect(userNamePart).toBeTruthy();

    // Ensure we did not add any fallback to other fields
    expect(JSON.stringify(filterArg)).not.toContain('user_name');
    expect(JSON.stringify(filterArg)).not.toContain('userName');

    // Must include tenant scoping (aliases allowed)
    const tenantPart = filterArg.$and.find(
      (p) =>
        p &&
        p.$or &&
        Array.isArray(p.$or) &&
        p.$or.some((c) => 'tenant_id' in c || 'organization_id' in c || 'organizationId' in c)
    );
    expect(tenantPart).toBeTruthy();
    expect(tenantPart.$or).toEqual(
      expect.arrayContaining([
        { tenant_id: 'TENANT_X' },
        { organization_id: 'TENANT_X' },
        { organizationId: 'TENANT_X' },
      ])
    );

    // Sanity check that DB chain was invoked for pagination
    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });

  test('q search returns empty (and does not drop filter) when no exact User_name match exists', async () => {
    // Arrange: DB returns no docs for the exact match filter.
    const docs = [];

    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docs),
    };

    SessionTracking.find.mockReturnValue(chain);
    SessionTracking.countDocuments.mockResolvedValue(0);

    const app = makeApp();

    const res = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q: 'Harish B', tenant_id: 'TENANT_X' })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: [],
      meta: { page: 1, limit: 10, total: 0 },
    });

    const filterArg = SessionTracking.find.mock.calls[0][0];

    // Critical invariant: when q is provided, we MUST include exact match on User_name,
    // and MUST NOT fall back to an empty/unfiltered query.
    expect(filterArg).toHaveProperty('$and');
    expect(Array.isArray(filterArg.$and)).toBe(true);
    expect(filterArg.$and).toEqual(
      expect.arrayContaining([{ User_name: 'Harish B' }])
    );
  });

  test('different q values do not reuse cached responses (cache key must include q and mount path)', async () => {
    // Enable cache explicitly for this test.
    process.env.ENABLE_ROUTE_CACHE = 'true';
    process.env.ENABLE_ETAG = 'false';

    const app = makeApp();

    // First request returns docs for User_name = Alice
    const docsAlice = [{ _id: 'a1', User_name: 'Alice', tenant_id: 'TENANT_X' }];
    const chainAlice = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docsAlice),
    };

    SessionTracking.find.mockReturnValueOnce(chainAlice);
    SessionTracking.countDocuments.mockResolvedValueOnce(1);

    const res1 = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q: 'Alice', tenant_id: 'TENANT_X' })
      .expect(200);

    expect(res1.body.data).toEqual(docsAlice);

    // Second request must NOT return Alice results when q=Bob.
    const docsBob = [{ _id: 'b1', User_name: 'Bob', tenant_id: 'TENANT_X' }];
    const chainBob = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docsBob),
    };

    SessionTracking.find.mockReturnValueOnce(chainBob);
    SessionTracking.countDocuments.mockResolvedValueOnce(1);

    const res2 = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q: 'Bob', tenant_id: 'TENANT_X' })
      .expect(200);

    expect(res2.body.data).toEqual(docsBob);

    // Ensure the handler actually executed DB twice (i.e., not a cache HIT for the second query)
    expect(SessionTracking.find).toHaveBeenCalledTimes(2);

    // Ensure filters were different between calls
    const filter1 = SessionTracking.find.mock.calls[0][0];
    const filter2 = SessionTracking.find.mock.calls[1][0];
    expect(JSON.stringify(filter1)).toContain('Alice');
    expect(JSON.stringify(filter2)).toContain('Bob');
  });

  test('cache does not mix responses across tenants (tenant must be part of cache key)', async () => {
    process.env.ENABLE_ROUTE_CACHE = 'true';
    process.env.ENABLE_ETAG = 'false';

    const app = makeApp();

    const docsTenantX = [{ _id: 'x1', User_name: 'Alice', tenant_id: 'TENANT_X' }];
    const chainX = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docsTenantX),
    };

    SessionTracking.find.mockReturnValueOnce(chainX);
    SessionTracking.countDocuments.mockResolvedValueOnce(1);

    const res1 = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q: 'Alice', tenant_id: 'TENANT_X' })
      .expect(200);

    expect(res1.body.data).toEqual(docsTenantX);

    // Same q, different tenant must not reuse cached response from TENANT_X.
    const docsTenantY = [{ _id: 'y1', User_name: 'Alice', tenant_id: 'TENANT_Y' }];
    const chainY = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docsTenantY),
    };

    SessionTracking.find.mockReturnValueOnce(chainY);
    SessionTracking.countDocuments.mockResolvedValueOnce(1);

    const res2 = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q: 'Alice', tenant_id: 'TENANT_Y' })
      .expect(200);

    expect(res2.body.data).toEqual(docsTenantY);
    expect(SessionTracking.find).toHaveBeenCalledTimes(2);
  });
});
