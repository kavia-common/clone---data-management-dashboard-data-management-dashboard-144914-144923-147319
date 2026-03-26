'use strict';

const express = require('express');
const request = require('supertest');

// Mock the SessionTracking model used by the route so we can inspect the generated filter.
jest.mock('../../models/sessionTracking.model', () => ({
  find: jest.fn(),
  aggregate: jest.fn(),
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

  test('q search filters by top-level User_name using $regex string + $options, and applies the same filter to find and total aggregation', async () => {
    // Arrange: return one matching doc (note: backend filters on `User_name`, not `user_name`)
    const docs = [{ _id: '1', User_name: 'Aditi S' }];

    // Provide chainable query builder for find().sort().skip().limit().lean()
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docs),
    };

    SessionTracking.find.mockReturnValue(chain);
    // The route computes total via aggregate([{ $match: <filter> }, { $count: 'total' }])
    SessionTracking.aggregate.mockResolvedValue([{ total: 1 }]);

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

    // Assert DB filter correctness
    expect(SessionTracking.find).toHaveBeenCalledTimes(1);
    expect(SessionTracking.aggregate).toHaveBeenCalledTimes(1);

    const findFilter = SessionTracking.find.mock.calls[0][0];
    const aggPipeline = SessionTracking.aggregate.mock.calls[0][0];
    const matchStage = Array.isArray(aggPipeline) ? aggPipeline[0] : null;
    const aggMatchFilter = matchStage && matchStage.$match ? matchStage.$match : null;

    // With T0000, bypass should avoid enforced tenant scope, so filter should be search-only.
    expect(findFilter).toEqual({
      $or: [
        {
          // Multi-word q uses whitespace-tolerant matching: "Aditi   S" should still match.
          User_name: { $regex: 'Aditi\\s+S', $options: 'i' },
        },
      ],
    });

    // Ensure total uses the exact same effective filter as find()
    expect(aggMatchFilter).toEqual(findFilter);

    // Sanity check that DB chain was invoked for pagination
    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });
});
