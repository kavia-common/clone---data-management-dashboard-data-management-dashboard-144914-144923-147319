'use strict';

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const routes = require('../index');
const SessionTracking = require('../../models/sessionTracking.model');

const MONGO_URL = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_session_filters';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

function authHeaders(tenant) {
  return {
    Authorization: 'Bearer ok',
    'x-tenant-id': tenant,
  };
}

describe('SessionTracking list filtering (date range, user)', () => {
  let app;
  const tenant = 'orgFilters';

  beforeAll(async () => {
    await mongoose.connect(MONGO_URL, { dbName: 'test_session_filters' });
    app = buildApp();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await SessionTracking.deleteMany({});
  });

  test('filters by startDate/endDate inclusive end-of-day (UTC)', async () => {
    // Seed three days: 2024-01-01, 2024-01-02, 2024-01-03
    const d1 = new Date(Date.UTC(2024, 0, 1, 10, 0, 0));
    const d2 = new Date(Date.UTC(2024, 0, 2, 12, 0, 0));
    const d3 = new Date(Date.UTC(2024, 0, 3, 14, 0, 0));
    await SessionTracking.insertMany([
      { tenant_id: tenant, user_id: 'u1', status: 'completed', last_updated: d1, session_start: d1 },
      { tenant_id: tenant, user_id: 'u2', status: 'completed', last_updated: d2, session_start: d2 },
      { tenant_id: tenant, user_id: 'u3', status: 'active', last_updated: d3, session_start: d3 },
      // cross-tenant noise
      { tenant_id: 'other', user_id: 'u9', status: 'completed', last_updated: d2, session_start: d2 },
    ]);

    // Query from 2024-01-01 to 2024-01-02 (inclusive EOD) should include d1 and d2 but not d3
    const res = await request(app)
      .get('/api/session-tracking')
      .query({
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-02T23:59:59.999Z', // any time on the day; server normalizes to end-of-day inclusive
        page: 1,
        limit: 100,
      })
      .set(authHeaders(tenant));

    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.data;
    const userIds = items.map((x) => x.user_id).sort();
    expect(userIds).toEqual(['u1', 'u2']); // exclude u3 and cross-tenant
  });

  test('filters by userId within default window', async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const older = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // older than 30 days default window

    await SessionTracking.insertMany([
      { tenant_id: tenant, user_id: 'u-match', status: 'completed', last_updated: recent, session_start: recent },
      { tenant_id: tenant, user_id: 'u-other', status: 'completed', last_updated: recent, session_start: recent },
      { tenant_id: tenant, user_id: 'u-match', status: 'completed', last_updated: older, session_start: older }, // outside default window
    ]);

    const res = await request(app)
      .get('/api/session-tracking')
      .query({ userId: 'u-match', page: 1, limit: 50 })
      .set(authHeaders(tenant));

    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.data;
    // Should include only recent u-match record within default 30d window
    expect(items.every((x) => x.user_id === 'u-match')).toBe(true);
    expect(items.length).toBe(1);
  });

  test('filters by email alias', async () => {
    const t = new Date();
    await SessionTracking.insertMany([
      { tenant_id: tenant, user_id: 'u1', user_email: 'a@example.com', status: 'completed', last_updated: t, session_start: t },
      { tenant_id: tenant, user_id: 'u2', email: 'b@example.com', status: 'completed', last_updated: t, session_start: t },
    ]);

    const resA = await request(app)
      .get('/api/session-tracking')
      .query({ email: 'a@example.com', page: 1, limit: 10 })
      .set(authHeaders(tenant));
    expect(resA.status).toBe(200);
    const itemsA = Array.isArray(resA.body) ? resA.body : resA.body.data;
    expect(itemsA.length).toBe(1);
    expect(itemsA[0].user_email || itemsA[0].email).toBe('a@example.com');

    const resB = await request(app)
      .get('/api/session-tracking')
      .query({ email: 'b@example.com', page: 1, limit: 10 })
      .set(authHeaders(tenant));
    expect(resB.status).toBe(200);
    const itemsB = Array.isArray(resB.body) ? resB.body : resB.body.data;
    expect(itemsB.length).toBe(1);
    expect(itemsB[0].user_id).toBe('u2');
  });
});
