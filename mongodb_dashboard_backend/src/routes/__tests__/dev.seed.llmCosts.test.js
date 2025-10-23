'use strict';

const request = require('supertest');
const app = require('../../app');

jest.mock('../../models/llmCosts.model', () => {
  const mockState = {
    count: 0,
    inserted: 0,
  };
  return {
    __esModule: true,
    default: {},
    // countDocuments used to check emptiness
    countDocuments: jest.fn(() => Promise.resolve(mockState.count)),
    // insertMany used to seed
    insertMany: jest.fn((docs) => {
      mockState.inserted = Array.isArray(docs) ? docs.length : 0;
      mockState.count += mockState.inserted;
      return Promise.resolve(docs);
    }),
    // findOne used for sample in response
    findOne: jest.fn(() => ({
      sort: () => ({
        lean: () => Promise.resolve({ llm_model: 'gpt-4o', total_cost: 0.01, timestamp: new Date().toISOString() }),
      }),
    })),
  };
});

describe('GET /api/dev/seed-llm-costs', () => {
  test('seeds when empty and returns summary', async () => {
    const res = await request(app).get('/api/dev/seed-llm-costs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('before', 0);
    expect(res.body).toHaveProperty('inserted');
    expect(res.body).toHaveProperty('after');
    expect(res.body).toHaveProperty('sample');
  });
});
