'use strict';

const { usageOverTime } = require('../llmCosts.usage.controller');
jest.mock('../../models/llmCosts.model', () => ({
  aggregate: jest.fn(() => ({ allowDiskUse: () => ({ exec: () => Promise.resolve([]) }) })),
}));

const LLMCost = require('../../models/llmCosts.model');

function mockRes() {
  return {
    statusCode: 200,
    _json: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this._json = payload;
      return this;
    },
  };
}

describe('usageOverTime controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 400 for invalid days param', async () => {
    const req = { query: { days: 'abc' } };
    const res = mockRes();
    await usageOverTime(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._json).toHaveProperty('message');
  });

  test('clamps days to 180 and returns items array', async () => {
    const now = new Date();
    const sevenDays = 7;
    // mock aggregate to return two models across two days
    LLMCost.aggregate.mockReturnValueOnce({
      allowDiskUse: () => ({
        exec: () =>
          Promise.resolve([
            { date: '2099-01-01', llm_model: 'gpt-4o', amount: 1.5 },
            { date: '2099-01-01', llm_model: 'claude-3', amount: 0.5 },
            { date: '2099-01-02', llm_model: 'gpt-4o', amount: 2.0 },
          ]),
      }),
    });

    const req = { query: { days: String(sevenDays) }, user: { id: 'u1' } };
    const res = mockRes();
    await usageOverTime(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json).toHaveProperty('items');
    expect(Array.isArray(res._json.items)).toBe(true);
    expect(res._json).toHaveProperty('meta.models');
    expect(res._json.meta.models).toEqual(expect.arrayContaining(['gpt-4o', 'claude-3']));
  });

  test('no data returns zero-filled series for given days', async () => {
    const req = { query: { days: '3' } };
    const res = mockRes();
    await usageOverTime(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.items.length).toBe(3);
    for (const item of res._json.items) {
      expect(item).toHaveProperty('date');
      expect(item).toHaveProperty('series');
      expect(typeof item.series).toBe('object');
    }
  });
});
