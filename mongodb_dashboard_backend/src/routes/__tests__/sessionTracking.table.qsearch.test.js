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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('q search matches ONLY exact user name (across field variants) and respects tenant_id scoping', async () => {
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
    // { $and: [ { $or:[{User_name:'Sumi P'},{user_name:'Sumi P'},{userName:'Sumi P'}] }, { $or:[{tenant_id:'TENANT_X'}, ...] } ] }
    const filterArg = SessionTracking.find.mock.calls[0][0];
    expect(filterArg).toHaveProperty('$and');
    expect(Array.isArray(filterArg.$and)).toBe(true);

    const userNamePart = filterArg.$and.find((p) => p && p.$or && Array.isArray(p.$or) && p.$or.some((c) => 'User_name' in c || 'user_name' in c || 'userName' in c));
    expect(userNamePart).toBeTruthy();
    expect(userNamePart.$or).toEqual(
      expect.arrayContaining([{ User_name: 'Sumi P' }, { user_name: 'Sumi P' }, { userName: 'Sumi P' }])
    );

    // Must include tenant scoping (aliases allowed)
    const tenantPart = filterArg.$and.find((p) => p && p.$or && Array.isArray(p.$or) && p.$or.some((c) => 'tenant_id' in c || 'organization_id' in c || 'organizationId' in c));
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
});
