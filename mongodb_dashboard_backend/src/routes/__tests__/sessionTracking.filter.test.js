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

describe('SessionTracking list filtering (canonical vs. legacy date range)', () => {
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

  test('filters by start and end params (canonical)', async () => {
    await SessionTracking.insertMany([
      { tenant_id: tenant, user_id: 'a', status: 'active', session_start: new Date('2023-01-01T10:00:00Z') },
      { tenant_id: tenant, user_id: 'b', status: 'active', session_start: new Date('2023-01-15T10:00:00Z') },
      { tenant_id: tenant, user_id: 'c', status: 'active', session_start: new Date('2023-02-01T10:00:00Z') },
    ]);
    const res = await request(app)
      .get('/api/session-tracking')
      .query({ start: '2023-01-01T00:00:00Z', end: '2023-01-31T23:59:59Z', page: 1, limit: 100 })
      .set(authHeaders(tenant));
    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.data;
    expect(items.length).toBe(2);
    const ids = items.map(x => x.user_id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  test('filters by from and to params (legacy)', async () => {
    await SessionTracking.insertMany([
      { tenant_id: tenant, user_id: 'a', status: 'active', session_start: new Date('2023-01-01T10:00:00Z') },
      { tenant_id: tenant, user_id: 'b', status: 'active', session_start: new Date('2023-01-15T10:00:00Z') },
      { tenant_id: tenant, user_id: 'c', status: 'active', session_start: new Date('2023-02-01T10:00:00Z') },
    ]);
    const res = await request(app)
      .get('/api/session-tracking')
      .query({ from: '2023-01-01T00:00:00Z', to: '2023-01-31T23:59:59Z', page: 1, limit: 100 })
      .set(authHeaders(tenant));
    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.data;
    expect(items.length).toBe(2);
    const ids = items.map(x => x.user_id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  test('uses only start/end when both canonical and legacy date params provided (canonical wins)', async () => {
    // 2 docs in Jan; 3rd doc in Feb
    await SessionTracking.insertMany([
      { tenant_id: tenant, user_id: 'a', status: 'active', session_start: new Date('2023-01-01T10:00:00Z') },
      { tenant_id: tenant, user_id: 'b', status: 'active', session_start: new Date('2023-01-15T10:00:00Z') },
      { tenant_id: tenant, user_id: 'c', status: 'active', session_start: new Date('2023-02-01T10:00:00Z') },
    ]);
    const res = await request(app)
      .get('/api/session-tracking')
      .query({
        start: '2023-01-01T00:00:00Z',
        end: '2023-01-31T23:59:59Z',
        from: '2023-01-01T00:00:00Z',
        to: '2023-02-28T23:59:59Z',
        page: 1,
        limit: 100,
      })
      .set(authHeaders(tenant));
    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.data;
    expect(items.length).toBe(2); // Only the canonical start/end should be used
    const ids = items.map(x => x.user_id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  test('returns all if no date params', async () => {
    await SessionTracking.insertMany([
      { tenant_id: tenant, user_id: 'a', status: 'active', session_start: new Date('2023-01-01T10:00:00Z') },
      { tenant_id: tenant, user_id: 'b', status: 'active', session_start: new Date('2023-01-15T10:00:00Z') },
      { tenant_id: tenant, user_id: 'c', status: 'active', session_start: new Date('2023-02-01T10:00:00Z') },
    ]);
    const res = await request(app)
      .get('/api/session-tracking')
      .set(authHeaders(tenant));
    expect(res.status).toBe(200);
    const items = Array.isArray(res.body) ? res.body : res.body.data;
    expect(items.length).toBe(3);
  });
});
