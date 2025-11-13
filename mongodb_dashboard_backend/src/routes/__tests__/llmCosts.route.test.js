'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../app');
const LLMCost = require('../../models/llmCosts.model');

describe('GET /api/llm-costs', () => {
  const TENANT = 'ORG_TEST_LLMCOSTS';
  beforeAll(async () => {
    process.env.ALLOW_DEMO_AUTH = 'true';
    // Ensure DB is connected by requiring app (app connects in server startup code if needed)
    // Insert a sample record
    await LLMCost.create({
      tenant_id: TENANT,
      project_id: 'proj1',
      user_id: 'user1',
      llm_model: 'gpt-4o',
      total_cost: 1.23,
      timestamp: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  afterAll(async () => {
    try {
      await LLMCost.deleteMany({ tenant_id: TENANT });
    } catch (_) {}
    // Close Mongoose to avoid open handles in jest
    try {
      await mongoose.connection.close();
    } catch (_) {}
  });

  it('returns records when organization_id is provided via query (no Authorization)', async () => {
    const res = await request(app)
      .get('/api/llm-costs')
      .query({ organization_id: TENANT, page: 1, limit: 5 })
      .expect(200);

    // In envelope mode we expect { success, data, meta }
    expect(res.body).toHaveProperty('success', true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
    // Expect at least one record
    const found = res.body.data.find((d) => d.tenant_id === TENANT);
    expect(found).toBeDefined();

    // Headers should surface applied tenant and filter
    expect(res.headers['x-applied-tenant'] || res.headers['x-organization-id']).toBe(String(TENANT));
  });

  it('supports camelCase organizationId alias in query', async () => {
    const res = await request(app)
      .get('/api/llm-costs')
      .query({ organizationId: TENANT })
      .expect(200);

    // Non-paginated path returns an array
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((d) => d.tenant_id === TENANT)).toBe(true);
  });
});
