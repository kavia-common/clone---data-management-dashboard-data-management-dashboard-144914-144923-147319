'use strict';

const request = require('supertest');
const app = require('../../app');
const mongoose = require('mongoose');
const User = require('../../models/user.model');

describe('GET /api/users date range filtering', () => {
  beforeAll(async () => {
    // Ensure in-memory Mongo is connected if test harness provides it; otherwise assume existing connection.
    // Clean and seed controlled data
    await User.deleteMany({});

    const docs = [
      {
        name: 'Old User',
        created_at: new Date('2025-03-15T10:00:00.000Z'),
        updated_at: new Date('2025-03-20T12:00:00.000Z'),
      },
      {
        name: 'April Created',
        created_at: new Date('2025-04-10T08:00:00.000Z'),
        updated_at: new Date('2025-04-10T08:00:00.000Z'),
      },
      {
        name: 'April Updated',
        created_at: new Date('2025-03-28T08:00:00.000Z'),
        updated_at: new Date('2025-04-29T13:39:39.491Z'),
      },
      {
        name: 'May User',
        created_at: new Date('2025-05-01T00:00:00.000Z'),
        updated_at: new Date('2025-05-01T00:00:00.000Z'),
      },
    ];
    await User.insertMany(docs);
  });

  afterAll(async () => {
    try {
      await User.deleteMany({});
    } catch (e) {}
    // Do not close mongoose connection; test runner manages lifecycle in this repo.
  });

  const APR_START = '2025-04-01T00:00:00.000Z';
  const APR_END = '2025-04-30T23:59:59.999Z';

  test('filters by startDate/endDate across created_at OR updated_at', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ startDate: APR_START, endDate: APR_END })
      .expect(200);

    // Response can be raw array (no pagination)
    const items = Array.isArray(res.body) ? res.body : res.body?.data;
    expect(Array.isArray(items)).toBe(true);

    const names = items.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['April Created', 'April Updated']));
    expect(names).not.toEqual(expect.arrayContaining(['Old User', 'May User']));
  });

  test('filters using preferred start/end aliases', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ start: APR_START, end: APR_END })
      .expect(200);

    const items = Array.isArray(res.body) ? res.body : res.body?.data;
    const names = items.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['April Created', 'April Updated']));
    expect(names).not.toEqual(expect.arrayContaining(['Old User', 'May User']));
  });

  test('works with pagination envelope and still filters correctly', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ startDate: APR_START, endDate: APR_END, page: 1, limit: 50 })
      .expect(200);

    expect(res.body && res.body.success).toBe(true);
    expect(res.body.meta).toBeDefined();
    expect(typeof res.body.meta.total).toBe('number');

    const names = res.body.data.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['April Created', 'April Updated']));
    expect(names).not.toEqual(expect.arrayContaining(['Old User', 'May User']));
  });

  test('excludes when outside range', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ startDate: '2025-04-15T00:00:00.000Z', endDate: '2025-04-16T23:59:59.999Z' })
      .expect(200);

    const items = Array.isArray(res.body) ? res.body : res.body?.data;
    const names = items.map((x) => x.name);
    expect(names).toEqual([]); // none of the seeded users fall strictly within Apr 15-16
  });
});
