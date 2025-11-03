'use strict';

const request = require('supertest');
const app = require('../../server'); // Express app export
const mongoose = require('mongoose');
const User = require('../../models/user.model');

describe('GET /api/users date range filtering', () => {
  beforeAll(async () => {
    // Ensure connection and clean collection
    if (mongoose.connection.readyState === 0) {
      // server.js should connect on import; otherwise connect here if necessary
    }
    await User.deleteMany({});
    const base = new Date('2024-01-01T12:00:00.000Z');
    // Seed 3 users on three consecutive days
    await User.insertMany([
      { email: 'a@example.com', created_at: new Date(base), updated_at: new Date(base) },
      {
        email: 'b@example.com',
        created_at: new Date('2024-01-02T05:30:00.000Z'),
        updated_at: new Date('2024-01-02T10:00:00.000Z'),
      },
      { email: 'c@example.com', created_at: new Date('2024-01-03T23:59:59.000Z'), updated_at: new Date('2024-01-03T23:59:59.000Z') },
    ]);
  });

  afterAll(async () => {
    try {
      await User.deleteMany({});
    } catch {}
  });

  test('filters inclusive by created_at for single day using start/end (preferred)', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({
        start: '2024-01-02T00:00:00.000Z',
        end: '2024-01-02T23:59:59.000Z',
        page: 1,
        limit: 50,
      })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    const items = res.body.data;
    const emails = items.map((u) => u.email).sort();
    // Should include user with created_at on Jan 2 only
    expect(emails).toEqual(['b@example.com']);
    // meta total should be 1
    expect(res.body.meta.total).toBe(1);
  });

  test('filters inclusive using legacy params startDate/endDate', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({
        startDate: '2024-01-01', // will expand to startOfDayUTC
        endDate: '2024-01-02',   // will expand to endOfDayUTC
      })
      .expect(200);

    // Non-paginated returns array
    expect(Array.isArray(res.body)).toBe(true);
    const emails = res.body.map((u) => u.email).sort();
    expect(emails).toEqual(['a@example.com', 'b@example.com']);
  });

  test('invalid date returns 400 with message', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({ start: 'invalid-date' })
      .expect(400);

    // Either message from util or generic invalid
    expect(res.body).toHaveProperty('success', false);
    expect(res.body.message).toMatch(/Invalid|date/i);
  });

  test('pagination still works with date filters', async () => {
    const res = await request(app)
      .get('/api/users')
      .query({
        start: '2024-01-01',
        end: '2024-01-03',
        page: 1,
        limit: 2,
        sort: 'created_at',
      })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.total).toBe(3);
  });
});
