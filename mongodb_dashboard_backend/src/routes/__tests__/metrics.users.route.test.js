'use strict';

const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const routes = require('../index');
const User = require('../../models/user.model');

const MONGO_URL = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_metrics_users_kpi';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

describe('/api/metrics/users tenant scoping and active filter', () => {
  let app;

  beforeAll(async () => {
    await mongoose.connect(MONGO_URL, { dbName: 'test_metrics_users_kpi' });
    app = buildApp();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  function authHeaders(tenant) {
    // Demo auth: verifyAuth treats 'ok' as valid; set x-tenant-id to inject tenant
    return {
      Authorization: 'Bearer ok',
      'x-tenant-id': tenant,
    };
  }

  test('scoped tenant returns counts only within tenant; active uses status=active strictly', async () => {
    // Seed users across tenants with varying status
    await User.insertMany([
      { tenant_id: 'orgA', email: 'a1@example.com', status: 'active' },
      { tenant_id: 'orgA', email: 'a2@example.com', status: 'inactive' },
      { tenant_id: 'orgA', email: 'a3@example.com', status: 'ACTIVE' },
      { tenant_id: 'orgA', email: 'a4@example.com', status: true }, // should NOT count as active
      { tenant_id: 'orgB', email: 'b1@example.com', status: 'active' },
      { tenant_id: 'orgB', email: 'b2@example.com', status: 'inactive' },
    ]);

    const resA = await request(app)
      .get('/api/metrics/users')
      .set(authHeaders('orgA'));

    expect(resA.status).toBe(200);
    expect(resA.body.success).toBe(true);
    // orgA has 4 total
    expect(resA.body.totalUsers).toBe(4);
    // active strictly 'active'/'ACTIVE' => a1 + a3 = 2
    expect(resA.body.activeUsers).toBe(2);

    const resB = await request(app)
      .get('/api/metrics/users')
      .set(authHeaders('orgB'));

    expect(resB.status).toBe(200);
    expect(resB.body.totalUsers).toBe(2);
    expect(resB.body.activeUsers).toBe(1);
  });

  test('T0000 returns counts across all tenants', async () => {
    await User.insertMany([
      { tenant_id: 'x1', email: 'x1@example.com', status: 'active' },
      { tenant_id: 'x2', email: 'x2@example.com', status: 'inactive' },
      { tenant_id: 'x3', email: 'x3@example.com', status: 'ACTIVE' },
      { tenant_id: 'x4', email: 'x4@example.com', status: true }, // should not count as active
    ]);

    const resAll = await request(app)
      .get('/api/metrics/users?organization_id=T0000')
      .set(authHeaders('ignoredTenant')); // header is ignored due to T0000

    expect(resAll.status).toBe(200);
    expect(resAll.body.success).toBe(true);
    // total across all = 4 (from this test) + potentially leftover from previous test suite's beforeEach clears, so exactly 4
    expect(resAll.body.totalUsers).toBe(4);
    // active strictly status: 'active' or 'ACTIVE' => 2
    expect(resAll.body.activeUsers).toBe(2);
  });

  test('Missing tenant when not T0000 yields 400', async () => {
    const res = await request(app)
      .get('/api/metrics/users')
      .set({ Authorization: 'Bearer ok' }); // no x-tenant-id and no organization_id provided

    expect([400, 403]).toContain(res.status); // requireTenant may 403 or our route may 400
  });

  test('organization_id alias supported and mapped', async () => {
    await User.insertMany([
      { tenant_id: 'orgZ', email: 'z1@example.com', status: 'active' },
      { tenant_id: 'orgZ', email: 'z2@example.com', status: 'inactive' },
      { tenant_id: 'orgY', email: 'y1@example.com', status: 'active' },
    ]);

    const resZ = await request(app)
      .get('/api/metrics/users?organization_id=orgZ')
      .set(authHeaders('orgZ'));

    expect(resZ.status).toBe(200);
    expect(resZ.body.totalUsers).toBe(2);
    expect(resZ.body.activeUsers).toBe(1);
  });
});
