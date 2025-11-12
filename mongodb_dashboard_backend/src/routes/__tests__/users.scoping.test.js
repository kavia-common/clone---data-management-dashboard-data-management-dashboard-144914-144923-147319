'use strict';

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const routes = require('../index');
const User = require('../../models/user.model');
const SessionTracking = require('../../models/sessionTracking.model');

const MONGO_URL = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_users_scoping';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

describe('Users tenant scoping', () => {
  let app;

  beforeAll(async () => {
    await mongoose.connect(MONGO_URL, { dbName: 'test_users_scoping' });
    app = buildApp();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await SessionTracking.deleteMany({});
  });

  function authHeaders(tenant) {
    // Demo auth mode: rely on verifyAuth demo path by providing token "ok" and header x-tenant-id
    return {
      Authorization: 'Bearer ok',
      'x-tenant-id': tenant,
    };
  }

  test('GET /api/users enforces tenant filter', async () => {
    // Seed two tenants
    await User.insertMany([
      { _id: new mongoose.Types.ObjectId(), tenant_id: 'orgA', email: 'a1@example.com', created_at: new Date() },
      { _id: new mongoose.Types.ObjectId(), tenant_id: 'orgA', email: 'a2@example.com', created_at: new Date() },
      { _id: new mongoose.Types.ObjectId(), tenant_id: 'orgB', email: 'b1@example.com', created_at: new Date() },
    ]);

    const resA = await request(app)
      .get('/api/users')
      .set(authHeaders('orgA'));

    expect(resA.status).toBe(200);
    const listA = Array.isArray(resA.body) ? resA.body : resA.body.data;
    expect(listA.every((u) => u.tenant_id === 'orgA')).toBe(true);

    const resB = await request(app)
      .get('/api/users')
      .set(authHeaders('orgB'));

    expect(resB.status).toBe(200);
    const listB = Array.isArray(resB.body) ? resB.body : resB.body.data;
    expect(listB.every((u) => u.tenant_id === 'orgB')).toBe(true);
  });

  test('GET /api/users/:id blocks cross-tenant access', async () => {
    const doc = await User.create({
      tenant_id: 'orgA',
      email: 'onlyA@example.com',
      created_at: new Date(),
    });

    const okRes = await request(app)
      .get(`/api/users/${String(doc._id)}`)
      .set(authHeaders('orgA'));
    expect(okRes.status).toBe(200);
    expect(okRes.body.tenant_id).toBe('orgA');

    const forbiddenRes = await request(app)
      .get(`/api/users/${String(doc._id)}`)
      .set(authHeaders('orgB'));
    expect(forbiddenRes.status).toBe(404); // not found in other tenant
  });

  test('GET /api/counts/users/count uses requireTenant and returns scoped counts', async () => {
    await User.insertMany([
      { tenant_id: 'orgA', email: 'a@example.com', created_at: new Date() },
      { tenant_id: 'orgB', email: 'b@example.com', created_at: new Date() },
      { tenant_id: 'orgB', email: 'b2@example.com', created_at: new Date() },
    ]);

    const resA = await request(app)
      .get('/api/users/count')
      .set(authHeaders('orgA'));
    expect(resA.status).toBe(200);
    expect(resA.body.total).toBe(1);

    const resB = await request(app)
      .get('/api/users/count')
      .set(authHeaders('orgB'));
    expect(resB.status).toBe(200);
    expect(resB.body.total).toBe(2);
  });

  test('GET /api/users/active-trend defaults to req.tenantId and forbids mismatch', async () => {
    const now = new Date();
    await SessionTracking.insertMany([
      { tenant_id: 'orgA', user_id: 'u1', status: 'completed', last_updated: now },
      { tenant_id: 'orgA', user_id: 'u2', status: 'completed', last_updated: now },
      { tenant_id: 'orgB', user_id: 'u3', status: 'completed', last_updated: now },
    ]);

    // Defaults to req.tenantId=orgA
    const ok = await request(app)
      .get('/api/users/active-trend')
      .set(authHeaders('orgA'));
    expect(ok.status).toBe(200);
    expect(ok.body.items.reduce((s, x) => s + x.total, 0)).toBeGreaterThan(0);

    // Mismatch query vs header should be forbidden
    const bad = await request(app)
      .get('/api/users/active-trend?tenant_id=orgB')
      .set(authHeaders('orgA'));
    expect(bad.status).toBe(403);
  });
});
