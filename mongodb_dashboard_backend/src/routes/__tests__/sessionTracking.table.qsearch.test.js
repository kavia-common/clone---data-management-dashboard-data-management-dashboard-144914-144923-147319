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

  test('q search matches ONLY username fields (`User_name` OR `user_name`) using a safe literal regex, and no other fields', async () => {
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

    const filterArg = SessionTracking.find.mock.calls[0][0];

    // With T0000, bypass should avoid enforced tenant scope, so filter should be search-only.
    // The contract is: ONLY username fields are searched (no other fields).
    expect(filterArg).toHaveProperty('$or');
    expect(Array.isArray(filterArg.$or)).toBe(true);
    expect(filterArg.$or).toHaveLength(2);

    const [a, b] = filterArg.$or;
    expect(Object.keys(a)).toEqual(['User_name']);
    expect(Object.keys(b)).toEqual(['user_name']);
    expect(a.User_name instanceof RegExp).toBe(true);
    expect(b.user_name instanceof RegExp).toBe(true);

    // Ensure whitespace-tolerant phrase regex is used (Aditi\\s+S)
    expect(String(a.User_name)).toMatch(/Aditi\\s\+S/i);
    expect(String(b.user_name)).toMatch(/Aditi\\s\+S/i);

    // Ensure we did NOT build any broader multi-field AND query.
    expect(filterArg).not.toHaveProperty('$and');

    // Sanity check that DB chain was invoked for pagination
    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });
});
