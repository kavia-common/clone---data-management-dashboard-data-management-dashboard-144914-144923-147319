'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const SessionTracking = require('../../models/sessionTracking.model');

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_AUTH = 'false';

// Helper: sign a JWT with given tenant
function sign(tenantId, claims = {}) {
  return jwt.sign(
    { sub: 'u1', tenantId, ...claims },
    JWT_SECRET,
    { algorithm: process.env.JWT_ALG || 'HS256', expiresIn: '1h' }
  );
}

describe('SessionTracking tenant scoping', () => {
  beforeAll(async () => {
    // Connect to in-memory or test DB; relies on CI/proj harness to provide MONGODB_URI
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dashboard_test';
    await mongoose.connect(uri, { dbName: 'dashboard_test' });
    await SessionTracking.deleteMany({});
    await SessionTracking.insertMany([
      { tenant_id: 'orgA', task_id: 'A-1', status: 'completed', session_start: new Date() },
      { tenant_id: 'orgA', task_id: 'A-2', status: 'active', session_start: new Date() },
      { tenant_id: 'orgB', task_id: 'B-1', status: 'completed', session_start: new Date() },
    ]);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  test('GET /api/session-tracking returns only orgA for JWT tenant orgA', async () => {
    const token = sign('orgA');
    const res = await request(app)
      .get('/api/session-tracking')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const items = Array.isArray(res.body.data) ? res.body.data : res.body;
    expect(Array.isArray(items)).toBe(true);
    expect(items.every((d) => d.tenant_id === 'orgA')).toBe(true);
  });

  test('query param tenant_id override is ignored; still returns only JWT tenant', async () => {
    const token = sign('orgA');
    const res = await request(app)
      .get('/api/session-tracking')
      .query({ filter: JSON.stringify({ tenant_id: 'orgB' }) })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const items = Array.isArray(res.body.data) ? res.body.data : res.body;
    expect(items.every((d) => d.tenant_id === 'orgA')).toBe(true);
  });

  test('GET /api/session-tracking returns only orgB for JWT tenant orgB', async () => {
    const token = sign('orgB');
    const res = await request(app)
      .get('/api/session-tracking')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const items = Array.isArray(res.body.data) ? res.body.data : res.body;
    expect(items.every((d) => d.tenant_id === 'orgB')).toBe(true);
  });

  test('Missing token -> 401 Unauthorized', async () => {
    await request(app).get('/api/session-tracking').expect(401);
  });
});
