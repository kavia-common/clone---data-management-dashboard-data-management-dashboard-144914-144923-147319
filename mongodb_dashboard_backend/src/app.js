const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Existing route modules (conditionally require if present)
function safeRequire(path) {
  try { return require(path); } catch { return null; }
}

const usersRoutes = safeRequire('./routes/users');
const llmCostsRoutes = safeRequire('./routes/llmCosts');
const sessionTrackingRoutes = safeRequire('./routes/sessionTracking');
const tenantsRoutes = safeRequire('./routes/tenants');
const dashboardRoutes = safeRequire('./routes/dashboard');
const deploymentsRoutes = safeRequire('./routes/deployments');
const authRoutes = safeRequire('./routes/auth');

// Proxy route
const proxySessionTracking = safeRequire('./routes/proxy.sessionTracking');

// Mount existing routes if available
if (usersRoutes) app.use('/api/users', usersRoutes);
if (llmCostsRoutes) app.use('/api/llm-costs', llmCostsRoutes);
if (sessionTrackingRoutes) app.use('/api/session-tracking', sessionTrackingRoutes);
if (tenantsRoutes) app.use('/api/tenants', tenantsRoutes);
if (dashboardRoutes) app.use('/api/dashboard', dashboardRoutes);
if (deploymentsRoutes) app.use('/api/app-deployments', deploymentsRoutes);
if (authRoutes) app.use('/api/auth', authRoutes);

// Mount proxy under /api/proxy
if (proxySessionTracking) app.use('/api/proxy', proxySessionTracking);

// Health endpoints
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/ready', (req, res) => res.json({ ready: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

module.exports = app;
