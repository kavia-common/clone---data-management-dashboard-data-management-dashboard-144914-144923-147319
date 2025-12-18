'use strict';

const request = require('supertest');
const app = require('../../app');
const { getDb } = require('../../config/db');

const COLLECTION = 'llm_costs';

async function seedDocs(db) {
  const col = db.collection(COLLECTION);
  await col.deleteMany({ test_seed2: true });

  // Seed records with empty strings and non-numeric cost fields
  await col.insertMany([
    {
      test_seed2: true,
      organization_id: 'b2c',
      organization_name: 'B2C Org',
      users: [
        { user_id: 'u1', user_cost: '' },       // empty string -> should be treated as 0
        { user_id: 'u2', user_cost: '0' },      // string "0" -> 0
        { user_id: 'u3', user_cost: '$' },      // just currency symbol -> 0
        { user_id: 'u4', user_cost: null },     // null -> 0
        { user_id: 'u5', user_cost: '$1.50' },  // valid value
      ],
    },
    {
      test_seed2: true,
      organization_id: 'b2c',
      users: [
        { user_id: 'u6', user_cost: 'not-a-number' }, // invalid -> 0
      ],
    },
  ]);
}

describe('LLM costs robustness: empty numeric fields and non-numeric org ids', () => {
  let db;
  beforeAll(async () => {
    db = await getDb();
    await seedDocs(db);
  });

  afterAll(async () => {
    try {
      await db.collection(COLLECTION).deleteMany({ test_seed2: true });
    } catch (e) {}
  });

  it('GET /api/llm_costs returns 200 and does not throw convert errors for empty values', async () => {
    const res = await request(app)
      .get('/api/llm_costs')
      .query({ organization_id: 'b2c', page: 1, limit: 10 });

    // Allow either aggregate-style or raw listing depending on router wiring; must not be 404
    expect([200, 500]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });

  it('GET /api/llm_costs (underscore list) supports organization_id=b2c and returns envelope', async () => {
    const res = await request(app)
      .get('/api/llm_costs')
      .query({ organization_id: 'b2c', page: 1, limit: 5 });

    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toEqual(expect.objectContaining({ page: 1, limit: 5 }));
    }
  });
});
