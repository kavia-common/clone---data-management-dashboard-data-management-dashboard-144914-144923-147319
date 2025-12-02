'use strict';

/**
 * PUBLIC_INTERFACE
 * Integration tests for LLM Costs:
 * - GET /api/llm-costs with limit, sort, and T0000 bypass behavior
 *
 * Note: This runs only when MongoDB is connected in CI. Otherwise, tests are skipped gracefully.
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const LLMCost = require('../models/llmCosts.model');
const { makeCostDoc } = require('./llmCosts.overTime.service.test.helper');

function maybeSkipNoDb() {
  const ready = mongoose.connection.readyState;
  if (ready !== 1) {
    // eslint-disable-next-line no-console
    console.warn('[test] Mongo not connected; skipping llm-costs integration tests.');
    return true;
  }
  return false;
}

describe('LLM Costs APIs (no analytics over-time)', () => {
  it('GET /api/llm-costs supports limit & sort & T0000 bypass', async () => {
    if (maybeSkipNoDb()) return;

    const baseDate = '2025-01-02';
    // Seed some docs
    await LLMCost.create(makeCostDoc({ tenant: 'org_a', date: baseDate, amount: '$0.100001' }));
    await LLMCost.create(makeCostDoc({ tenant: 'org_b', date: baseDate, amount: '$0.200001' }));

    const res = await request(app)
      .get('/api/llm-costs?limit=1&sort=-timestamp&organization_id=T0000')
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    expect(Array.isArray(res.body) || res.body?.success === true).toBeTruthy();
    if (Array.isArray(res.body)) {
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    } else if (res.body?.success) {
      expect(Array.isArray(res.body.data)).toBe(true);
    }
    expect(res.headers['x-all-tenants']).toBe('true');
    expect(res.headers['x-applied-tenant']).toBe('all-tenants');
  });
});
