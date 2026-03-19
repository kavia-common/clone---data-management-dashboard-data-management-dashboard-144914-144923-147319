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

  test('multi-word q search builds a valid AND-of-regex tokens for user_name/User_name', async () => {
    // Arrange: return one matching doc.
    const docs = [{ _id: '1', user_name: 'Aditi S' }];

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

    // Act
    const res = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q: 'Aditi S', organization_id: 'T0000' })
      .expect(200);

    // Assert payload
    expect(res.body).toEqual({
      success: true,
      data: docs,
      meta: { page: 1, limit: 10, total: 1 },
    });

    // Assert filter shape: should include an $or that contains a token AND matcher for user_name/User_name.
    const filterArg = SessionTracking.find.mock.calls[0][0];

    // With T0000, bypass should avoid enforced tenant scope, so filter should be search-only.
    expect(filterArg).toHaveProperty('$or');
    expect(Array.isArray(filterArg.$or)).toBe(true);

    // First item is our inserted token matcher (unshift).
    const first = filterArg.$or[0];
    expect(first).toHaveProperty('$or');
    expect(Array.isArray(first.$or)).toBe(true);

    // Ensure the AND token constraints exist and are actual regexes on the fields (valid Mongo shape).
    const [variant1, variant2] = first.$or;
    expect(variant1).toHaveProperty('$and');
    expect(variant2).toHaveProperty('$and');

    // Each $and element should be like { user_name: /Aditi/i } etc.
    for (const cond of variant1.$and) {
      expect(cond).toHaveProperty('user_name');
      expect(cond.user_name).toBeInstanceOf(RegExp);
    }
    for (const cond of variant2.$and) {
      expect(cond).toHaveProperty('User_name');
      expect(cond.User_name).toBeInstanceOf(RegExp);
    }

    // Sanity check that DB chain was invoked for pagination
    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });
});
