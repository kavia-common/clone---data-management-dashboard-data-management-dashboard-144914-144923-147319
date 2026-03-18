'use strict';

const request = require('supertest');
const app = require('../../app');

describe('Session Tracking - q search escaping', () => {
  test('GET /api/session-tracking does not fail when q contains regex special chars and tenant_id is provided', async () => {
    // This input would throw if passed directly to new RegExp(q, 'i')
    const q = '[';

    // We do not require a live DB connection for this regression:
    // - The route builds the filter before executing the query.
    // - If regex construction fails, it returns 400 immediately.
    // With DB missing, execution may still fail, but it should NOT fail due to invalid regex.
    const res = await request(app)
      .get('/api/session-tracking')
      .query({ tenant_id: 'T0001', q, page: 1, limit: 1 });

    // Accept either:
    // - 200 (if DB is available)
    // - 400 (if DB query fails due to no DB), BUT message must not be regex construction failure.
    expect([200, 400]).toContain(res.status);

    if (res.status === 400) {
      const msg = `${res.body?.message || ''} ${res.body?.details || ''}`.toLowerCase();
      expect(msg).not.toContain('invalid regular expression');
      expect(msg).not.toContain('unterminated');
    }
  });

  test('GET /api/session-tracking/composite does not fail when q contains regex special chars and tenant_id is provided', async () => {
    const q = '[';

    const res = await request(app)
      .get('/api/session-tracking/composite')
      .query({ tenant_id: 'T0001', q, page: 1, limit: 1, include_breakdowns: false, include_series: false });

    // Composite route has explicit DB-not-connected graceful fallback returning 200;
    // this test ensures q does not crash the endpoint.
    expect([200, 400]).toContain(res.status);

    if (res.status === 400) {
      const msg = `${res.body?.message || ''} ${res.body?.details || ''}`.toLowerCase();
      expect(msg).not.toContain('invalid regular expression');
      expect(msg).not.toContain('unterminated');
    }
  });
});
