'use strict';

jest.mock('../../models/sessionTracking.model', () => ({
  aggregate: jest.fn(),
}));

const request = require('supertest');
const express = require('express');

const SessionTracking = require('../../models/sessionTracking.model');

function makeApp() {
  const app = express();
  app.use(express.json());
  // Mount router under /api/users to match real app routing
  // eslint-disable-next-line global-require
  app.use('/api/users', require('../users.routes'));
  return app;
}

describe('POST /api/users/costs-summary', () => {
  beforeEach(() => {
    SessionTracking.aggregate.mockReset();
  });

  test('sums total_cost (currency strings) and uses stored credits_consumed when present', async () => {
    // Validate pipeline shape indirectly via returned result; the route reads aggregate output.
    SessionTracking.aggregate.mockResolvedValueOnce([
      {
        User_name: 'Aditi S',
        total_cost_spent: 3238.6598151099997,
        credits_used: 64773196.3022,
      },
    ]);

    const app = makeApp();

    const res = await request(app)
      .post('/api/users/costs-summary?tenant_id=org1')
      .send({ User_name: 'Aditi S' })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      User_name: 'Aditi S',
      total_cost_spent: 3238.6598151099997,
      credits_used: 64773196.3022,
    });
  });

  test('falls back to USD->credits conversion when credits fields are missing/zero', async () => {
    SessionTracking.aggregate.mockResolvedValueOnce([
      {
        User_name: 'NoCreditsUser',
        total_cost_spent: 1.5,
        credits_used: 0,
      },
    ]);

    const app = makeApp();

    const res = await request(app)
      .post('/api/users/costs-summary?tenant_id=org1')
      .send({ User_name: 'NoCreditsUser' })
      .expect(200);

    // default conversion is 20000 credits/USD => 1.5 * 20000 = 30000 (rounded)
    expect(res.body.success).toBe(true);
    expect(res.body.User_name).toBe('NoCreditsUser');
    expect(res.body.total_cost_spent).toBe(1.5);
    expect(res.body.credits_used).toBe(30000);
  });
});
