'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const LLMCost = require('../../models/llmCosts.model');

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_AUTH = 'false';

// PUBLIC_INTERFACE
function sign(tenantId, claims = {}) {
  /** Sign a short-lived JWT with a tenant claim for tests */
  return jwt.sign(
    { sub: 'u1', tenantId, ...claims },
    JWT_SECRET,
    { algorithm: process.env.JWT_ALG || 'HS256', expiresIn: '1h' }
  );
}

describe('LLMCosts tenant scoping via crudFactory', () => {
  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dashboard_test';
    await mongoose.connect(uri, { dbName: 'dashboard_test' });
    await LLMCost.deleteMany({});
    await LLMCost.insertMany([
      { tenant_id: 'xOrg', llm_model: 'gpt-4o', total_cost: 1.23, timestamp: new Date() },
      { tenant_id: 'yOrg', llm_model: 'gpt-4o-mini', total_cost: 2.34, timestamp: new Date() },
    ]);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  test('conflicting tenant_id in query is ignored; JWT tenant enforced', async () => {
    const token = sign('xOrg');
    const res = await request(app)
      .get('/api/llm-costs')
      .query({ filter: JSON.stringify({ tenant_id: 'yOrg' }) })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const payload = res.body?.data || res.body;
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.length).toBeGreaterThan(0);
    // Ensure all returned items are for xOrg despite query asking for yOrg
    expect(payload.every((it) => it.tenant_id === 'xOrg')).toBe(true);
  });
});
