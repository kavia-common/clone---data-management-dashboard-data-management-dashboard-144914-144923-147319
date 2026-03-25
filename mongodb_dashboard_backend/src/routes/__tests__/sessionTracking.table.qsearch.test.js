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

  test('q search filters by top-level User_name using {$regex:<escaped string>,$options:"i"} and applies identical filter to find() and aggregate($match)', async () => {
    // Arrange: return one matching doc (backend filters on `User_name`)
    const docs = [{ _id: '1', User_name: 'Test User' }];
    const q = docs[0].User_name;

    // Provide chainable query builder for find().sort().skip().limit().lean()
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docs),
    };

    SessionTracking.find.mockReturnValue(chain);
    SessionTracking.aggregate.mockResolvedValue([{ total: 1 }]);

    const app = makeApp();

    // Act
    const res = await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q, organization_id: 'T0000' })
      .expect(200);

    // Assert payload (route returns standard list envelope)
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

    // Route escapes regex literals, so the $regex value is the literal string (escaped if needed).
    expect(findFilter).toEqual({
      $or: [
        {
          User_name: { $regex: q, $options: 'i' },
        },
      ],
    });

    // Ensure total uses the exact same effective filter as find()
    expect(aggMatchFilter).toEqual(findFilter);

    // Sanity check pagination chain usage
    expect(chain.sort).toHaveBeenCalled();
    expect(chain.skip).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
    expect(chain.lean).toHaveBeenCalled();
  });

  test('q search escapes regex metacharacters so it behaves as a literal substring match', async () => {
    const docs = [{ _id: '1', User_name: 'A.B' }];
    const q = 'A.B';

    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docs),
    };

    SessionTracking.find.mockReturnValue(chain);
    SessionTracking.aggregate.mockResolvedValue([{ total: 1 }]);

    const app = makeApp();

    await request(app)
      .get('/api/session-tracking/table')
      .query({ page: 1, limit: 10, q, organization_id: 'T0000' })
      .expect(200);

    const findFilter = SessionTracking.find.mock.calls[0][0];
    expect(findFilter).toEqual({
      $or: [
        {
          User_name: { $regex: 'A\\.B', $options: 'i' },
        },
      ],
    });
  });
});
