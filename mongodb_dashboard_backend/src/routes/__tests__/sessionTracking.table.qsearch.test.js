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

  test('multi-word q search matches ONLY User_name and uses safe literal regexes', async () => {
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
    expect(filterArg).toHaveProperty('$or');
    expect(Array.isArray(filterArg.$or)).toBe(true);

    // First item is our inserted token matcher (unshift) for multi-word:
    // { $and: [ {User_name:/Aditi/i}, {User_name:/S/i} ] }
    const first = filterArg.$or[0];
    expect(first).toHaveProperty('$and');
    expect(Array.isArray(first.$and)).toBe(true);

    for (const cond of first.$and) {
      expect(cond).toHaveProperty('User_name');
      expect(cond.User_name).toBeInstanceOf(RegExp);
    }

    // Also assert the "phrase" regex used in the other OR part is whitespace-tolerant.
    const phraseUserNamePart = filterArg.$or.find((p) => p && p.User_name instanceof RegExp);
    expect(phraseUserNamePart).toBeTruthy();
    expect(String(phraseUserNamePart.User_name)).toMatch(/Aditi\\s\+S/i);

    // Ensure we are NOT searching other fields anymore (smoke-check).
    expect(filterArg.$or.some((p) => p && Object.prototype.hasOwnProperty.call(p, 'tenant_id'))).toBe(false);
    expect(filterArg.$or.some((p) => p && Object.prototype.hasOwnProperty.call(p, 'user_id'))).toBe(false);
    expect(filterArg.$or.some((p) => p && Object.prototype.hasOwnProperty.call(p, 'user_name'))).toBe(false);

    // Sanity check that DB chain was invoked for pagination
    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });
});
