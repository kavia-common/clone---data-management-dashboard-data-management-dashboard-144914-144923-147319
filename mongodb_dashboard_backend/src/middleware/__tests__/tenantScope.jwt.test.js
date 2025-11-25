const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { verifyAuth } = require('../verifyAuth');
const { requireTenant } = require('../requireTenant');

describe('JWT tenant scoping middleware', () => {
  const secret = 'test-secret';
  const makeApp = (payload = {}) => {
    process.env.JWT_SECRET = secret;
    const app = express();
    app.get('/protected', verifyAuth, requireTenant, (req, res) => {
      res.json({
        ok: true,
        authTenant: req.auth?.tenantId || null,
        organizationId: req.organizationId || null,
        tenantId: req.tenantId || null,
      });
    });
    return app;
  };

  it('sets req.organizationId and req.tenantId from JWT tenant_id', async () => {
    const token = jwt.sign({ sub: 'u1', tenant_id: 'org_X' }, secret);
    const app = makeApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toMatchObject({
      ok: true,
      authTenant: 'org_X',
      organizationId: 'org_X',
      tenantId: 'org_X',
    });
  });

  it('works with organization_id claim too', async () => {
    const token = jwt.sign({ sub: 'u2', organization_id: 'org_Y' }, secret);
    const app = makeApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.organizationId).toBe('org_Y');
    expect(res.body.tenantId).toBe('org_Y');
  });
});
