'use strict';

const request = require('supertest');
const app = require('../../app');
const mongoose = require('mongoose');
const LLMCost = require('../../models/llmCosts.model');

describe('LLM Costs tenant scoping', () => {
  const TENANT_A = 'T0000';
  const TENANT_B = 'T0001';

  beforeAll(async () => {
    // Ensure connection is established
    if (mongoose.connection.readyState === 0) {
      // app.js initializes db on import; nothing else here
    }
    // Seed a few cost docs for each tenant
    await LLMCost.deleteMany({ tenant_id: { $in: [TENANT_A, TENANT_B] } });
    await LLMCost.insertMany([
      { tenant_id: TENANT_A, total_cost: 1.23, llm_model: 'gpt-4o', timestamp: new Date() },
      { tenant_id: TENANT_A, total_cost: 0.77, llm_model: 'gpt-4o-mini', timestamp: new Date() },
      { tenant_id: TENANT_B, total_cost: 5.0, llm_model: 'claude-3', timestamp: new Date() },
    ]);
  });

  afterAll(async () => {
    await LLMCost.deleteMany({ tenant_id: { $in: [TENANT_A, TENANT_B] } });
  });

  test('returns only data for the provided x-organization-id when using header (no JWT in tests)', async () => {
    const res = await request(app)
      .get('/api/llm-costs?page=1&limit=10')
      .set('Authorization', 'Bearer ok')
      .set('x-organization-id', TENANT_A)
      .expect(200);

    expect(res.headers['x-applied-tenant']).toBe(TENANT_A);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    const items = res.body.data;
    expect(Array.isArray(items)).toBe(true);
    // Should include A but not B
    expect(items.some((d) => d.tenant_id === TENANT_A)).toBe(true);
    expect(items.some((d) => d.tenant_id === TENANT_B)).toBe(false);
  });

  test('denies cross-tenant access when query tries to switch tenant against header/JWT', async () => {
    const res = await request(app)
      .get(`/api/llm-costs?page=1&limit=10&organization_id=${TENANT_B}`)
      .set('Authorization', 'Bearer ok')
      .set('x-organization-id', TENANT_A)
      .expect(403);

    expect(res.body).toHaveProperty('success', false);
    expect(String(res.body.message || '').toLowerCase()).toContain('forbidden');
  });
});
