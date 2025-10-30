const healthService = require('../services/health');

/**
 * PUBLIC_INTERFACE
 * HealthController provides a simple /health style response indicating service status.
 * Does not rely on database connectivity; intended for readiness/liveness checks.
 */
class HealthController {
  /**
   * PUBLIC_INTERFACE
   * Responds with a basic health status JSON.
   * @param {import('express').Request} req - Express request
   * @param {import('express').Response} res - Express response
   * @returns {import('express').Response} 200 JSON with status fields
   */
  check(req, res) {
    const healthStatus = healthService.getStatus();
    return res.status(200).json(healthStatus);
  }
}

module.exports = new HealthController();
