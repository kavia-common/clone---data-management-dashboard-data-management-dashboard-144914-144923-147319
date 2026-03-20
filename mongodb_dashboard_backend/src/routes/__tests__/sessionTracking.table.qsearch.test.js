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

  test('q search matches ONLY the `User_name` field (safe literal regex), and no other fields', async () => {
    // Arrange: return one matching doc.
    const docs = [{ _id: '1', User_name: 'Aditi S' }];

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

    const filterArg = SessionTracking.find.mock.calls[0][0];

    // With T0000, bypass should avoid enforced tenant scope, so filter should be search-only.
    // The contract is: ONLY `User_name` is searched.
    expect(filterArg).toHaveProperty('User_name');
    expect(filterArg.User_name instanceof RegExp).toBe(true);

    // Ensure whitespace-tolerant phrase regex is used (Aditi\s+S)
    expect(String(filterArg.User_name)).toMatch(/Aditi\\s\+S/i);

    // Ensure we did NOT build any multi-field OR query.
    expect(filterArg).not.toHaveProperty('$or');
    expect(filterArg).not.toHaveProperty('$and');

    // Sanity check that DB chain was invoked for pagination
    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });
});
