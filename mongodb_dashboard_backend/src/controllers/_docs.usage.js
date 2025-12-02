'use strict';

/**
 * PUBLIC_INTERFACE
 * GET /api/usage
 * Minimal developer help route that describes health and docs paths.
 * This is intended for quick verification in dev/preview and returns static text.
 */
function usage(req, res) {
  const base = `${req.protocol}://${req.get('host')}`;
  const lines = [
    'Backend usage (developer helper):',
    `- Health: ${base}/health (aliases: /healthz, /ready, /api/health)`,
    `- Swagger UI: ${base}/api-docs (aliases: /docs, /api/docs)`,
    `- OpenAPI JSON: ${base}/openapi.json`,
    `- Session tracking: ${base}/api/session-tracking`,
    '',
    'Tip: look for "READY: http://HOST:PORT" in logs after start.',
  ];
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.status(200).send(lines.join('\n'));
}

module.exports = { usage };
