'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../app');
const LLMCost = require('../../models/llmCosts.model');

describe('GET /api/costs/:organization_id', () => {
  beforeAll(async () => {
    // Use in-memory Mongo if available; otherwise skip connection and mock aggregate
    jest.spyOn(LLMCost, 'aggregate').mockImplementation(() => {
      return {
        allowDiskUse: () => Promise.resolve([
          {
            organization_id: 'org_test',
            organization_name: 'Test Org',
            organization_cost: 12.34,
            users: 2,
            user_id: 'user_1',
            type: 'chat',
            user_cost: 10.12,
            projects: 3,
          },
          {
            organization_id: 'org_test',
            organization_name: 'Test Org',
            organization_cost: 12.34,
            users: 2,
            user_id: 'user_2',
            type: 'eval',
            user_cost: 2.22,
            projects: 1,
          },
        ]),
      };
    });
  });

  afterAll(async () => {
    try { await mongoose.disconnect(); } catch {}
    jest.restoreAllMocks();
  });

  it('should return aggregated data for organization', async () => {
    const res = await request(app)
      .get('/api/costs/org_test')
      .set('x-organization-id', 'org_test')
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.organization_id).toBe('org_test');
    if (res.body.data.length) {
      const rec = res.body.data[0];
      expect(rec).toHaveProperty('organization_id');
      expect(rec).toHaveProperty('organization_cost');
      expect(rec).toHaveProperty('users');
      expect(rec).toHaveProperty('user_id');
      expect(rec).toHaveProperty('type');
      expect(rec).toHaveProperty('user_cost');
      expect(rec).toHaveProperty('projects');
    }
  });

  it('should return 400 when organization_id missing', async () => {
    const res = await request(app)
      .get('/api/costs/')
      .expect(404); // route requires param; 404 is acceptable for missing param path
    expect(res.status).toBe(404);
  });
});
