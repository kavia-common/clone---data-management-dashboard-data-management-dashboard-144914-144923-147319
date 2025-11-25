'use strict';

/**
 * PUBLIC_INTERFACE
 * permissiveCorsMiddleware
 * Strictly permissive, non-credentialed CORS for /api/*:
 * - Access-Control-Allow-Origin: *
 * - Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
 * - Access-Control-Allow-Headers: Echoes Access-Control-Request-Headers or defaults to a safe superset
 * - No Access-Control-Allow-Credentials (must stay absent when ACAO='*')
 * - Preflight OPTIONS returns 204 immediately
 * - Always sets CORS headers for all responses (including 4xx/5xx)
 *
 * Also logs Origin and Access-Control-Request-Headers in non-production for diagnostics when DEBUG=true.
 */
function permissiveCorsMiddleware(req, res, next) {
  // Always set ACAO "*" for /api/* requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  // IMPORTANT: Do NOT set Access-Control-Allow-Credentials when using '*'
  // res.removeHeader('Access-Control-Allow-Credentials'); // ensure it's not present

  // Consolidated allow methods
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );

  // Reflect requested headers for preflight; otherwise, provide a permissive default superset
  const requested = req.headers['access-control-request-headers'];
  const defaultAllowed =
    'Content-Type,Authorization,Accept,x-tenant-id,x-tenant,Origin,User-Agent,Cache-Control,Pragma';
  res.setHeader(
    'Access-Control-Allow-Headers',
    requested && typeof requested === 'string' && requested.trim() !== ''
      ? requested
      : defaultAllowed
  );

  // Expose some common headers (safe)
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type,Content-Length');

  // Cache preflight result briefly (optional, conservative)
  res.setHeader('Access-Control-Max-Age', '600');

  // Debug logging for /api/users diagnostics in non-production or DEBUG=true
  const debug =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.DEBUG || '').toLowerCase() === 'true';
  if (debug && req.path && (req.path === '/api/users' || req.path.startsWith('/api/users'))) {
     
    console.log(
      `[CORS][users] origin=${req.headers.origin || 'n/a'} ACRH=${requested || 'n/a'} method=${req.method}`
    );
  }

  // Handle preflight OPTIONS early with 204
  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }

  return next();
}

const permissive = { permissiveCorsMiddleware };
module.exports = { ...permissive, default: permissive };