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
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SESSION_TRACKING_Q_EXACT;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('multi-word q search applies ONLY to User_name, and is used for both find() and countDocuments()', async () => {
    const docs = [{ _id: '1', User_name: 'Aditi S' }];

    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docs),
    };

    SessionTracking.find.mockReturnValue(chain);
    SessionTracking.countDocuments.mockResolvedValue(1);

    const app = makeApp();

    const res = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q: 'Aditi S', organization_id: 'T0000' })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: docs,
      meta: { page: 1, limit: 10, total: 1 },
    });

    const findFilterArg = SessionTracking.find.mock.calls[0][0];
    const countFilterArg = SessionTracking.countDocuments.mock.calls[0][0];

    expect(findFilterArg).toBeTruthy();
    expect(countFilterArg).toEqual(findFilterArg);

    expect(findFilterArg).toHaveProperty('$or');
    expect(Array.isArray(findFilterArg.$or)).toBe(true);

    const tokenMatcher = findFilterArg.$or.find((p) => p && Array.isArray(p.$and));
    expect(tokenMatcher).toBeTruthy();
    for (const cond of tokenMatcher.$and) {
      expect(cond).toHaveProperty('User_name');
      expect(cond.User_name).toBeInstanceOf(RegExp);
    }

    const phraseMatcher = findFilterArg.$or.find((p) => p && p.User_name instanceof RegExp);
    expect(phraseMatcher).toBeTruthy();
    expect(String(phraseMatcher.User_name)).toMatch(/Aditi\\s\+S/i);

    const hasLowerUserName = JSON.stringify(findFilterArg).includes('user_name');
    expect(hasLowerUserName).toBe(false);

    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });

  test('exact q search mode (SESSION_TRACKING_Q_EXACT=true) applies case-insensitive exact match ONLY on User_name', async () => {
    process.env.SESSION_TRACKING_Q_EXACT = 'true';

    const docs = [{ _id: '1', User_name: 'Aditi S' }];

    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docs),
    };

    SessionTracking.find.mockReturnValue(chain);
    SessionTracking.countDocuments.mockResolvedValue(1);

    const app = makeApp();

    await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q: 'Aditi S', organization_id: 'T0000' })
      .expect(200);

    const findFilterArg = SessionTracking.find.mock.calls[0][0];
    expect(findFilterArg).toBeTruthy();

    // Exact mode should produce { User_name: /^Aditi S$/i } (escaped)
    expect(findFilterArg).toHaveProperty('User_name');
    expect(findFilterArg.User_name).toBeInstanceOf(RegExp);
    expect(String(findFilterArg.User_name)).toMatch(/^\^Aditi S\$\//i);

    // Must not include any other fields (sanity)
    const serialized = JSON.stringify(findFilterArg);
    expect(serialized.includes('user_name')).toBe(false);
    expect(serialized.includes('tenant_id')).toBe(false);
    expect(serialized.includes('organization_name')).toBe(false);
  });
});
