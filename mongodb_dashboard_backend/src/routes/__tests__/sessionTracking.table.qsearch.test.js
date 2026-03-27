'use strict';

const express = require('express');
const request = require('supertest');

// Mock SessionTracking model used by the route so we can inspect generated filters.
jest.mock('../../models/sessionTracking.model', () => ({
  find: jest.fn(),
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
}));

/**
 * Mock User model used to resolve q(user_name) -> user_id(s)
 * For this route, q name lookup can match multiple users; we must return all matching IDs.
 */
jest.mock('../../models/user.model', () => ({
  find: jest.fn(),
}));

const SessionTracking = require('../../models/sessionTracking.model');
const User = require('../../models/user.model');

function makeApp() {
  const app = express();
  // Mount exactly the same router used by /api/session-tracking/table.
  // The table router is a re-export of sessionTracking.routes.
  const tableRouter = require('../sessionTracking.table.routes');
  app.use('/api/session-tracking/table', tableRouter);
  return app;
}

describe('GET /api/session-tracking/table q-search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('when q matches a user name, it resolves ALL matching user_ids and filters sessions by user_id ∈ matched ids', async () => {
    const resolvedUserIds = [
      '5468b4d8-a011-70ba-9c6a-107907f7cd7d',
      '2458c458-c001-70c5-2723-eb967913b891',
    ];

    // Mock: users lookup chain find().sort().lean()
    const userChain = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { _id: '507f1f77bcf86cd799439011', user_id: resolvedUserIds[0] },
        { _id: '507f1f77bcf86cd799439012', user_id: resolvedUserIds[1] },
      ]),
    };
    User.find.mockReturnValue(userChain);

    const docs = [
      { _id: 's1', user_id: resolvedUserIds[0], User_name: 'Sumi P' },
      { _id: 's2', user_id: resolvedUserIds[1], User_name: 'Sumi P' },
    ];

    // Mock: SessionTracking find() chain
    const chain = {
      setOptions: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docs),
    };
    SessionTracking.find.mockReturnValue(chain);

    // Total should be computed via countDocuments(dbFilter)
    SessionTracking.countDocuments.mockResolvedValue(29);

    const app = makeApp();

    const res = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 50, q: 'Sumi P', organization_id: 'T0000' })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: docs,
      meta: { page: 1, limit: 50, total: 29, matchedUserIds: resolvedUserIds },
    });

    // Backend should expose resolved user ids for debuggability
    expect(res.headers['x-sessiontracking-q-resolved-userids']).toBe(resolvedUserIds.join(','));
    // Back-compat header still provides the first id
    expect(res.headers['x-sessiontracking-q-resolved-userid']).toBe(resolvedUserIds[0]);

    // Ensure q->userIds resolution was attempted
    expect(User.find).toHaveBeenCalledTimes(1);

    // Ensure DB was filtered by the resolved userIds (type-safe via $toString + $in)
    expect(SessionTracking.find).toHaveBeenCalledTimes(1);
    const findFilter = SessionTracking.find.mock.calls[0][0];
    expect(findFilter).toEqual({
      $expr: { $in: [{ $toString: '$user_id' }, resolvedUserIds] },
    });

    expect(SessionTracking.countDocuments).toHaveBeenCalledTimes(1);
    expect(SessionTracking.countDocuments.mock.calls[0][0]).toEqual(findFilter);

    // Pagination chain sanity
    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });
});
