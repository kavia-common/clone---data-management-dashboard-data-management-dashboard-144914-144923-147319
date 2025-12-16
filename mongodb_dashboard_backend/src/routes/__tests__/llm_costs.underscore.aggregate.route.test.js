'use strict';

const request = require('supertest');
const app = require('../../app');
const { getDb } = require('../../config/db');

const COLLECTION = 'llm_costs';

async function seedDocs(db) {
  const col = db.collection(COLLECTION);
  await col.deleteMany({ test_seed: true });

  // org A with 2 docs and nested users/projects
  await col.insertOne({
    test_seed: true,
    organization_id: 'orgA',
    organization_name: 'Org A',
    users: [
      { user_id: 'u1', user_cost: '$1.25', projects: [{ id: 'p1' }, { id: 'p2' }] },
      { user_id: 'u2', user_cost: '$2.50', projects: [{ id: 'p3' }] },
    ],
  });
  await col.insertOne({
    test_seed: true,
    organization_id: 'orgA',
    organization_name: 'Org A',
    users: [
      { user_id: 'u3', user_cost: '$0.25', projects: [] },
      { user_id: 'u4', user_cost: '$3.00', projects: [{ id: 'p4' }, { id: 'p5' }, { id: 'p6' }] },
    ],
  });

  // org B single doc
  await col.insertOne({
    test_seed: true,
    organization_id: 'orgB',
    organization_name: 'Org B',
    users: [
      { user_id: 'u9', user_cost: '$10.00', projects: [{ id: 'px' }] },
    ],
  });
}

describe('GET /api/llm_costs (underscore) nested aggregation', () => {
  let db;
  beforeAll(async () => {
    db = await getDb();
    await seedDocs(db);
  });

  afterAll(async () => {
    try {
      await db.collection(COLLECTION).deleteMany({ test_seed: true });
    } catch (e) {}
  });

  it('aggregates by organization and parses currency strings', async () => {
    const res = await request(app)
      .get('/api/llm_costs')
      .query({ page: 1, limit: 10 })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);

    const orgA = res.body.data.find(r => r.organization_id === 'orgA');
    const orgB = res.body.data.find(r => r.organization_id === 'orgB');

    // orgA usersCost = 1.25 + 2.50 + 0.25 + 3.00 = 7.00
    expect(orgA).toBeTruthy();
    expect(orgA.organization_cost).toBeCloseTo(7.0, 6);
    expect(orgA.cost).toBeCloseTo(7.0, 6);
    // users count: 4
    expect(orgA.users).toBe(4);
    // projects count: 2 + 1 + 0 + 3 = 6
    expect(orgA.projects).toBe(6);

    // orgB usersCost = 10
    expect(orgB).toBeTruthy();
    expect(orgB.organization_cost).toBeCloseTo(10.0, 6);
    expect(orgB.users).toBe(1);
    expect(orgB.projects).toBe(1);

    // headers
    expect(res.headers['x-llm-costs-collection']).toBe(COLLECTION);
    expect(res.headers['x-llm-costs-postgroupcount']).toBeDefined();
  });

  it('filters by organization_id exact match and paginates', async () => {
    const res = await request(app)
      .get('/api/llm_costs')
      .query({ organization_id: 'orgB', page: 1, limit: 1 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.data[0].organization_id).toBe('orgB');
    expect(res.body.meta).toEqual(expect.objectContaining({ page: 1, limit: 1, total: 1 }));
  });

  it('clamps invalid pagination defaults', async () => {
    const res = await request(app)
      .get('/api/llm_costs')
      .query({ page: 0, limit: 0 }) // invalid -> default to page 1, limit 10
      .expect(200);

    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(10);
  });
});
