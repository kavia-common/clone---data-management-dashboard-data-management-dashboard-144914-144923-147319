'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { getBaseOpenApiSpec } = require('../swagger');
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');
const { connectDB } = require('./config/db');
const mongoose = require('mongoose');
const { errorHandler } = require('./middleware/standardHandlers');
const cors = require('cors');

const app = express();

// TEMP STARTUP LOGS to trace route mounting (will be removed after verification)
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Initializing Express app for Dashboard API');
  console.log(`[startup] Process PID=${process.pid} NODE_ENV=${process.env.NODE_ENV || 'development'}`);
  console.log(`[startup] Intended bind HOST=${process.env.HOST || '0.0.0.0'} PORT=${Number(process.env.PORT) || 3001}`);
} catch {}

// Register a minimal, import-safe liveness route BEFORE any other imports/mounts.
// This guarantees GET /health returns 200 even if other modules fail to import.
app.get('/health', (req, res) => {
  try {
    return res.status(200).json({
      status: 'ok',
      ready: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  } catch {
    return res.status(200).json({ status: 'ok', ready: true });
  }
});

app.set('trust proxy', true); // only trust local proxies
app.use(helmetMiddleware());
// app.use(corsMiddleware());
app.use(cors({
  origin: '*'
}));
app.use(rateLimiter());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const buildDynamicSpec = (req) => {
  const host = req.get('host');
  let protocol = req.secure ? 'https' : req.protocol;
  const actualPort = req.socket?.localPort;
  const hasPort = host.includes(':');
  const needsPort =
    !hasPort &&
    ((protocol === 'http' && actualPort !== 80) ||
      (protocol === 'https' && actualPort !== 443));
  const fullHost = needsPort ? `${host}:${actualPort}` : host;

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
    servers: [
      {
        url:
          process.env.SWAGGER_SERVER_URL ||
          `${protocol}://${fullHost}`,
      },
    ],

  };
};

app.get('/openapi.json', (req, res) => res.json(buildDynamicSpec(req)));
app.get('/api-docs.json', (req, res) => res.json(buildDynamicSpec(req)));

const swaggerUiHandler = swaggerUi.setup(null, {
  swaggerOptions: {
    url: '/openapi.json',
    displayRequestDuration: true,
    docExpansion: 'none',
  },
  customSiteTitle: process.env.SWAGGER_TITLE || 'Dashboard API Docs',
});
app.use('/docs', swaggerUi.serve, swaggerUiHandler);
app.use('/api-docs', swaggerUi.serve, swaggerUiHandler);

 // Base router (non-/api) for health and overview
try {
  const baseRouter = require('./routes');
  app.use('/', baseRouter);
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[startup] Failed to mount base router:', e?.message || e);
  // Provide fallback root path to avoid 404 at "/"
  app.get('/', (req, res) => res.status(200).json({ status: 'ok', ready: true, hint: 'base router fallback (mount failed)' }));
}

/**
 * Simple health with DB status
 * PUBLIC_INTERFACE
 * GET /health
 */
app.get('/health', (req, res) => {
  try {
    const ready = (mongoose && mongoose.connection && mongoose.connection.readyState) || 0;
    const db =
      ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
    const payload = {
      status: 'ok',
      db,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
    if (db !== 'connected') {
      payload.hint =
        'Database not connected. Ensure MONGODB_URI is set in environment (.env).';
    }
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(200).json({ status: 'ok', db: 'unknown', hint: 'Health degraded but server running' });
  }
});

/**
 * Simple health with DB status (namespaced)
 */
app.get('/api/health', (req, res) => {
  try {
    const ready = (mongoose && mongoose.connection && mongoose.connection.readyState) || 0;
    const db =
      ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
    const payload = { status: 'ok', db };
    if (db !== 'connected') {
      payload.hint =
        'Database not connected. Ensure MONGODB_URI is set in environment (.env).';
    }
    return res.status(200).json(payload);
  } catch {
    return res.status(200).json({ status: 'ok', db: 'unknown', hint: 'Health degraded but server running' });
  }
});

if (process.env.NODE_ENV === 'test') {
  try { mongoose.set('bufferCommands', false); } catch {}
  app.use((req, res, next) => {
    const p = req.path || req.originalUrl || '';
    const bypass =
      p === '/' ||
      p.startsWith('/health') ||
      p.startsWith('/openapi.json') ||
      p.startsWith('/api-docs.json') ||
      p.startsWith('/docs') ||
      p.startsWith('/api-docs') ||
      p.startsWith('/api/dev');
    if (bypass) return next();
    if (mongoose.connection.readyState !== 1) {
      return res
        .status(503)
        .json({ success: false, message: 'Service unavailable: database not connected (test mode)' });
    }
    return next();
  });
}

try {
  app.use('/api/dev', require('./routes/dev.routes'));
} catch (e) {
  console.error('[startup] Skipping /api/dev (failed to load):', e?.message || e);
}

/**
 * Public API routes
 * Users CRUD and analytics summary
 */
try {
  console.log('[startup] Mounting /api/users routes...');
  app.use('/api/users', require('./routes/users.routes'));
} catch (e) {
  console.error('[startup] Skipping /api/users (failed to load):', e?.message || e);
}

try {
  console.log('[startup] Mounting /api/users tenant-summary routes...');
  const usersAnalyticsSummaryRouter = require('./routes/users.analytics.summary.routes');
  if (usersAnalyticsSummaryRouter && usersAnalyticsSummaryRouter.stack) {
    console.log('[startup] users.analytics.summary router loaded with', usersAnalyticsSummaryRouter.stack.length, 'layers');
  }
  app.use('/api/users', usersAnalyticsSummaryRouter);

  // Inline fallback handler for tenant-summary to avoid 404s if router wiring changes.
  console.log('[startup] Registering inline fallback for GET /api/users/tenant-summary');
  const { getUsersTenantSummary } = require('./controllers/users.analytics.summary.controller');
  app.get('/api/users/tenant-summary', async (req, res) => {
    try {
      const fakeRes = {
        _status: 200,
        _sent: false,
        status(code) { this._status = code; return this; },
        json(payload) { this._sent = true; this._payload = payload; return this; }
      };
      await getUsersTenantSummary(req, fakeRes);
      if (!fakeRes._sent) {
        return res.status(500).json({ success: false, message: 'Controller did not respond' });
      }
      if (fakeRes._status !== 200) {
        return res.status(fakeRes._status).json(fakeRes._payload);
      }
      const items = Array.isArray(fakeRes._payload?.items) ? fakeRes._payload.items : [];
      const mapped = items.map((it) => ({
        tenant: it.tenant_name || it.tenant_id || '',
        count: typeof it.user_count === 'number' ? it.user_count : 0,
      }));
      return res.status(200).json(mapped);
    } catch (err) {
      console.error('[tenant-summary.inline] error:', err?.message || err);
      return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  });
} catch (e) {
  console.error('[startup] Skipping users tenant-summary routes (failed to load):', e?.message || e);
}

try {
  const analyticsAgentsRoutes = require('./routes/analyticsAgents');
  app.use('/api/analytics/agents', analyticsAgentsRoutes);
} catch (e) {
  console.error('[startup] Skipping /api/analytics/agents (failed to load):', e?.message || e);
}

const safeMount = (path, loader) => {
  try {
    app.use(path, loader());
  } catch (e) {
    console.error(`[startup] Skipping ${path} (failed to load):`, e?.message || e);
  }
};

// Provide both kebab and camelCase aliases for session tracking and deployments
safeMount('/api/session-tracking', () => require('./routes/sessionTracking.routes'));
safeMount('/api/sessionTracking', () => require('./routes/sessionTracking.routes'));

/* Analytics endpoints */
safeMount('/api/analytics', () => require('./routes/featureUsage.routes'));
safeMount('/api/analytics', () => require('./routes/analytics.sessionsPerDay.routes'));

safeMount('/api/app-deployments', () => require('./routes/appDeployments.routes'));
safeMount('/api/appDeployments', () => require('./routes/appDeployments.routes'));

// Sample data
safeMount('/api/data', () => require('./routes/data.routes'));

// Costs aggregate endpoints (non-users analytics)
safeMount('/api/costs', () => require('./routes/costs.byAgent.routes'));

// LLM costs endpoints
safeMount('/api/llm-costs', () => require('./routes/llmCosts.routes'));
safeMount('/api/llmCosts', () => require('./routes/llmCosts.routes'));

// Tenants, Projects, Auth, Session
safeMount('/api/tenants', () => require('./routes/tenants.routes'));
safeMount('/api/projects', () => require('./routes/projects.routes'));
safeMount('/api/session', () => require('./routes/session.routes'));
safeMount('/api/dashboard', () => require('./routes/dashboard.routes'));
safeMount('/api/dashboard/overview', () => require('./routes/dashboard.modules.routes'));
safeMount('/api/auth', () => require('./routes/auth.routes'));

/* Users analytics routes have been fully removed to avoid dangling references */

// 404 JSON
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Not Found',
    path: req.originalUrl,
  });
});

// Error handler should be last
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  connectDB().catch((err) => {
    console.error('Failed to connect to MongoDB on startup:', err.message);
  });
} else {
  console.log('[startup] Skipping MongoDB connection in test environment');
  try { mongoose.set('bufferCommands', false); } catch {}
}

module.exports = app;
