# JWT Auth Middleware Usage

Public interfaces:
- verifyTenantAccess (exported as verifyAuth via src/middleware/index.js)
- requireTenant
- applyTenantFilter (for Mongoose/Mongo find criteria)
- withTenantMatch (for Mongo aggregation pipelines)

How to protect routes:
```js
const express = require('express');
const { verifyAuth } = require('../middleware'); // maps to verifyTenantAccess
const { requireTenant } = require('../middleware/requireTenant');
const router = express.Router();

router.use(verifyAuth, requireTenant);

router.get('/', (req, res) => { /* ... */ });
```

How to enforce tenant in queries:
- Mongoose Query:
```js
const { applyTenantFilter } = require('../middleware/jwtAuth');
const q = Model.find({});
applyTenantFilter(q, req.auth.tenantId);
const docs = await q.lean();
```

- Plain criteria object (Mongo native or Mongoose):
```js
const { applyTenantFilter } = require('../middleware/jwtAuth');
const criteria = applyTenantFilter({ status: 'active' }, req.auth.tenantId);
// use criteria in find/count operations
```

Aggregations:
```js
const { withTenantMatch } = require('../middleware/jwtAuth');
const pipeline = withTenantMatch([
  { $group: { _id: '$service_type', total: { $sum: 1 } } }
], req.auth.tenantId);
const data = await collection.aggregate(pipeline).toArray();
```

Token rules:
- Authorization: Bearer <token> required. Cookies (id_token) are tolerated if present but not required.
- HS256 verification with JWT_SECRET (or 'dev-secret' in non-production).
- Optional issuer/audience checks via JWT_ISSUER/JWT_AUDIENCE or COGNITO_*.
- Tenant claim normalization: custom:tenant_id OR tenant_id OR tenantId OR organization_id. Normalized to req.auth.tenantId and req.tenantId.
