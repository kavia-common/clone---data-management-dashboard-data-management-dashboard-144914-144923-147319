const healthService = require('../services/health');

/**
 * PUBLIC_INTERFACE
 * HealthController provides a minimal liveness/health response that never throws,
 * even if MongoDB is not configured or is down.
 */
class HealthController {
  // PUBLIC_INTERFACE
  check(req, res) {
    try {
      const healthStatus = healthService.getStatus();
      // Always indicate service is up; include hint if DB unavailable
      return res.status(200).json({ ready: true, ...healthStatus });
    } catch (err) {
      // Defensive catch to ensure health never fails due to import/runtime issues
      return res.status(200).json({
        ready: true,
        status: 'ok',
        message: 'Service is healthy (degraded)',
        hint: 'An internal error occurred computing health details, but server is running.',
        error: typeof err?.message === 'string' ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        host: process.env.HOST || '0.0.0.0',
        port: Number(process.env.PORT) || 3001
      });
    }
  }
}

module.exports = new HealthController();
