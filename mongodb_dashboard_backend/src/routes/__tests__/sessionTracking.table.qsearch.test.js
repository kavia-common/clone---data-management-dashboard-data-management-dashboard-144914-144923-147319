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

  test('multi-word q search applies ONLY to User_name, and is used for both find() and countDocuments()', async () => {
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

    const findFilterArg = SessionTracking.find.mock.calls[0][0];
    const countFilterArg = SessionTracking.countDocuments.mock.calls[0][0];

    // With T0000, bypass should avoid enforced tenant scope, so filter should be search-only.
    expect(findFilterArg).toBeTruthy();

    // Ensure both find and count use the SAME filter object (behavioral requirement)
    expect(countFilterArg).toEqual(findFilterArg);

    // Filter shape should be either:
    // - { User_name: /.../i } for single token, OR
    // - { $or: [ { $and: [...] }, { User_name: /phrase/ } ] } for multi-token
    // We provided 2 tokens ("Aditi", "S"), so expect $or form.
    expect(findFilterArg).toHaveProperty('$or');
    expect(Array.isArray(findFilterArg.$or)).toBe(true);

    // Should contain a token AND matcher that targets ONLY User_name.
    const tokenMatcher = findFilterArg.$or.find((p) => p && Array.isArray(p.$and));
    expect(tokenMatcher).toBeTruthy();
    for (const cond of tokenMatcher.$and) {
      expect(cond).toHaveProperty('User_name');
      expect(cond.User_name).toBeInstanceOf(RegExp);
    }

    // Should contain a phrase regex matcher that targets ONLY User_name and is whitespace-tolerant.
    const phraseMatcher = findFilterArg.$or.find((p) => p && p.User_name instanceof RegExp);
    expect(phraseMatcher).toBeTruthy();
    expect(String(phraseMatcher.User_name)).toMatch(/Aditi\\s\+S/i);

    // And MUST NOT include user_name field matching anymore.
    const hasLowerUserName = JSON.stringify(findFilterArg).includes('user_name');
    expect(hasLowerUserName).toBe(false);

    // Sanity check that DB chain was invoked for pagination
    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });
});
