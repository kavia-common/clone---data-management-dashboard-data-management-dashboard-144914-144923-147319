'use strict';

const request = require('supertest');
const app = require('../../app');

jest.mock('../../models/llmCosts.model', () => ({
  aggregate: jest.fn(() => ({
    allowDiskUse: () => ({
      exec: () =>
        Promise.resolve([
          { date: '2099-01-01', llm_model: 'gpt-4o', amount: 1.0 },
          { date: '2099-01-01', llm_model: 'claude-3', amount: 2.0 },
        ]),
    }),
  })),
}));

describe('GET /api/llm-costs/usage-over-time', () => {
  test('returns 200 and items/meta', async () => {
    const res = await request(app).get('/api/llm-costs/usage-over-time?days=2');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('meta');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(Array.isArray(res.body.meta.models)).toBe(true);
  });

  test('invalid days -> 400', async () => {
    const res = await request(app).get('/api/llm-costs/usage-over-time?days=zero');
    expect(res.status).toBe(400);
  });
});
