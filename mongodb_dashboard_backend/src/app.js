const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { getBaseOpenApiSpec } = require('../swagger');
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');
const { permissiveCorsMiddleware } = require('./middleware/permissiveCors');
const { connectDB } = require('./config/db');
const mongoose = require('mongoose');
const { errorHandler } = require('./middleware/standardHandlers');
const cors = require('cors');
const compression = require('compression');

const app = express();

// ---------------------------------------------
// Middleware
// ---------------------------------------------
app.set('trust proxy', 1);
app.use(helmetMiddleware());
app.use(corsMiddleware());
 // Apply our permissive echo-origin CORS for all /api paths (after security cors for broad handling)
 app.use('/api', permissiveCorsMiddleware);
 // Explicit preflight handling for all /api paths (including summary and users)
 // Single wildcard path is sufficient; ensure it is registered early.
 app.options('/api/*', cors());
app.use(rateLimiter());

// Response compression (gzip/brotli) controlled by ENABLE_RESPONSE_COMPRESSION
const ENABLE_RESPONSE_COMPRESSION = String(process.env.ENABLE_RESPONSE_COMPRESSION || 'true').toLowerCase() === 'true';
if (ENABLE_RESPONSE_COMPRESSION) {
  app.use(
    compression({
      // express compression enables brotli if available via Node zlib automatically when client supports it
      threshold: 1024, // compress payloads > 1KB
      filter: (req, res) => {
        // allow clients to opt-out
        if (req.headers['x-no-compress']) {
          return false;
        }
        return compression.filter(req, res);
      }
    })
  );
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------
// Swagger setup
// ---------------------------------------------
const buildDynamicSpec = (req) => {
  const host = req.get('host');
  const protocol = req.secure ? 'https' : req.protocol;
  const actualPort = req.socket?.localPort;
  const hasPort = host.includes(':');
  const needsPort =
    !hasPort &&
    ((protocol === 'http' && actualPort !== 80) ||
      (protocol === 'https' && actualPort !== 443));
  const fullHost = hasPort ? host : `${host}${needsPort ? `:${actualPort}` : ''}`;
  const baseSpec = getBaseOpenApiSpec();
  return {
    ...baseSpec,
    info: {
      ...baseSpec.info,
      title: process.env.SWAGGER_TITLE || baseSpec.info?.title || 'Dashboard API',
      version: process.env.SWAGGER_VERSION || baseSpec.info?.version || '1.0.0',
      description:
        process.env.SWAGGER_DESCRIPTION ||
        baseSpec.info?.description ||
        'REST API for Data Management Dashboard with MongoDB and Express',
    },
    // Use same-origin server so Swagger calls hit this backend instance
    // url: `${protocol}://${fullHost}`,
    servers: [
      {
        // url: 'https://kavia-dashboard-kavia-dev.cloud.kavia.ai',
        url:'https://kavia-dashboard-kavia-beta.cloud.kavia.ai',
        // description: 'Predefined dev server',
        description: 'Predefined beta server',
      },
    ],
  };
};


app.get('/openapi.json', (req, res) => res.json(buildDynamicSpec(req)));
app.get('/api-docs.json', (req, res) => res.json(buildDynamicSpec(req)));
app.get('/api/docs.json', (req, res) => res.json(buildDynamicSpec(req)));

const swaggerUiHandler = swaggerUi.setup(null, {
  swaggerOptions: {
    url: '/api-docs.json',
    displayRequestDuration: true,
    docExpansion: 'none',
  },
  customSiteTitle: process.env.SWAGGER_TITLE || 'Dashboard API Docs',
  customCss:
    '.topbar-wrapper .link:after { content: " | Authorize with Bearer token; tenant is implicit (organization_id). If no token, use x-organization-id header."; font-size: 12px; color: #666; }',
});

app.use('/api/docs', swaggerUi.serve, swaggerUiHandler);
app.use('/docs', swaggerUi.serve, swaggerUiHandler);
app.use('/api-docs', swaggerUi.serve, swaggerUiHandler);

// ---------------------------------------------
// Health endpoints
// ---------------------------------------------
const healthHandler = (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  const payload = { status: 'ok', db, timestamp: new Date().toISOString() };
  if (db !== 'connected') {
    payload.hint = 'Database not connected. Ensure MONGODB_URI is set.';
  }
  res.set('Cache-Control', 'no-store');
  return res.status(200).json(payload);
};
app.get(['/api/health', '/health', '/healthz', '/ready', '/live'], healthHandler);
// Log at registration time to aid diagnosis if server boots but probes fail to reach
try {
  // eslint-disable-next-line no-console
  console.log('[routes] Health endpoints registered at: /health, /api/health, /healthz, /ready, /live');
} catch {}

// ---------------------------------------------
// Root path handler (landing)
// ---------------------------------------------
// PUBLIC_INTERFACE
// Minimal root path handler that returns a simple JSON landing without interfering
// with API routes or any static asset serving (none configured here).
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    success: true,
    message: 'Dashboard API backend. Visit /api-docs for Swagger UI or /api/health for health.',
    docs: '/api-docs',
    health: '/api/health',
    timestamp: new Date().toISOString()
  });
});

// ---------------------------------------------
// Routers
// ---------------------------------------------
const safeUse = (path, router) => {
  if (router && typeof router === 'function') {app.use(path, router);}
};

const baseRouter = require('./routes');
/**
 * Ensure exactly-one '/api' prefix:
 * - baseRouter mounts '/users' etc. relative to here, so effective paths are '/api/users/...'
 * - Do NOT mount baseRouter at both '/' and '/api' or you'll create dupes like '/api/api/...'
 */
safeUse('/api', baseRouter);

safeUse('/api/dev', require('./routes/dev.routes'));
// Do NOT mount '/api/users' here; baseRouter ('/'), via src/routes/index.js, already mounts
// users.summary before users.routes to ensure '/summary' resolves prior to '/:id'.
// Mounting again here could change precedence or duplicate handlers.

// ---------------------------------------------
// Protected routes (with auth + tenant)
// ---------------------------------------------
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
    if (req.path.startsWith('/api/') && !req.path.startsWith('/api/auth')) {
      // Developer debug headers (disabled logs)
    }
  }
  next();
});

safeUse('/api/session-tracking/composite', require('./routes/sessionTracking.composite.routes'));
safeUse('/api/session-tracking', require('./routes/sessionTracking.routes'));
safeUse('/api/sessionTracking', require('./routes/sessionTracking.routes'));
safeUse('/api/analytics/agents', require('./routes/analyticsAgents'));

safeUse('/api/analytics', require('./routes/analytics'));
safeUse('/api/app-deployments', require('./routes/appDeployments.routes'));
safeUse('/api/appDeployments', require('./routes/appDeployments.routes'));
safeUse('/api/costs', require('./routes/costs.byAgent.routes'));
safeUse('/api/costs', require('./routes/costs.organization.routes'));
safeUse('/api/costs', require('./routes/llmCosts.enriched.routes'));
safeUse('/api/llm-costs', require('./routes/llmCosts.public.routes')); // list endpoint delegates to fallback controller with diagnostics
safeUse('/api/llm-costs', require('./routes/llmCosts.routes'));
safeUse('/api/llm-costs', require('./routes/llmCosts.hierarchy.routes'));
safeUse('/api/tenants', require('./routes/tenants.routes'));
safeUse('/api/llm_costs', require('./routes/costs.llm_costs.routes'));
safeUse('/api/projects', require('./routes/projects.summary.routes'));
safeUse('/api/service-type', require('./routes/serviceType.summary.routes'));
safeUse('/api/projects', require('./routes/projects.routes'));
try {
  // eslint-disable-next-line no-console
  console.log('[routes] Projects routes registered at: GET /api/projects/summary and /api/projects/*');
} catch {}
safeUse('/api/session', require('./routes/session.routes'));
safeUse('/api/dashboard', require('./routes/dashboard.routes'));
safeUse('/api/metrics/users', require('./routes/metrics.users.routes'));
safeUse('/api/dashboard/overview', require('./routes/dashboard.modules.routes'));
safeUse('/api/auth', require('./routes/auth.routes'));

// ---------------------------------------------
// 404 + Error handler
// ---------------------------------------------
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Not Found',
    path: req.originalUrl,
  });
});
app.use(errorHandler);

// ---------------------------------------------
// MongoDB Connection
// ---------------------------------------------
if (process.env.NODE_ENV !== 'test') {
  if (!process.env.MONGODB_URI) {
    console.warn('[startup] MONGODB_URI not set. Starting without DB connection.');
  } else {
    connectDB()
      .then(async () => {
        try {
          const { ensureLlmCostsIndexes } = require('./models/llmCosts.indexes');
          // fire-and-forget; do not await to keep startup snappy
          Promise.resolve(ensureLlmCostsIndexes())
            .then(() => console.log('[startup] ensureLlmCostsIndexes scheduled'))
            .catch((e) => console.warn('[startup] ensureLlmCostsIndexes failed:', e?.message || e));
        } catch (e) {
          console.warn('[startup] ensureLlmCostsIndexes unavailable:', e?.message || e);
        }
      })
      .catch((err) =>
        console.error('Failed to connect to MongoDB on startup:', err.message)
      );
  }
} else {
  try { mongoose.set('bufferCommands', false); } catch { }
}

module.exports = app;