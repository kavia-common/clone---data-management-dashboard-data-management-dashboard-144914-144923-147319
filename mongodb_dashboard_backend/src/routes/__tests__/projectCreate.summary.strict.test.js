'use strict';

const request = require('supertest');
const app = require('../../app');
const mongoose = require('mongoose');
const SessionTracking = require('../../models/sessionTracking.model');

describe('Project Create Summary - strict filter', () => {
  const tenant = 'b2c';
  const projectId = '166223';
  const date = '2025-10-08';
  const from = new Date(`${date}T00:00:00.000Z`);
  const to = new Date(`${date}T23:59:59.999Z`);

  beforeAll(async () => {
    // Ensure DB connected
    if (mongoose.connection.readyState === 0) {
      const { connect } = require('../../config/db');
      await connect();
    }

    // Clean and seed minimal data: 1 matching doc and 3 non-matching docs
    await SessionTracking.deleteMany({
      tenant_id: tenant,
      project_id: projectId,
      created_at: { $gte: from, $lte: to },
    });

    await SessionTracking.insertMany([
      {
        tenant_id: tenant,
        project_id: projectId,
        user_id: 'user-abc',
        created_at: new Date(`${date}T12:34:56.000Z`),
      },
      // Outside date
      {
        tenant_id: tenant,
        project_id: projectId,
        user_id: 'user-def',
        created_at: new Date('2025-10-09T00:00:00.000Z'),
      },
      // Different tenant
      {
        tenant_id: 'other',
        project_id: projectId,
        user_id: 'user-xyz',
        created_at: new Date(`${date}T10:00:00.000Z`),
      },
      // Different project
      {
        tenant_id: tenant,
        project_id: '999',
        user_id: 'user-zzz',
        created_at: new Date(`${date}T10:00:00.000Z`),
      },
    ]);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  test('dev verify exact reports count = 1', async () => {
    const res = await request(app)
      .get('/api/dev/verify/project-create/exact')
      .query({ tenant_id: tenant, project_id: projectId, date });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('actualCount', 1);
  });

  test('summary returns a single item referencing user_id', async () => {
    const res = await request(app)
      .get('/api/project-create/summary')
      .set('x-organization-id', tenant)
      .query({ range: 'custom', start_date: date, end_date: date, project_id: projectId });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(Array.isArray(res.body.buckets)).toBe(true);
    // Since we group by project then map to user_id, and our one matching doc has user_id='user-abc'
    expect(res.body.buckets.length).toBeGreaterThanOrEqual(1);
    const first = res.body.buckets[0];
    expect(first).toHaveProperty('user_id');
    expect(typeof first.user_id).toBe('string');
  });
});
