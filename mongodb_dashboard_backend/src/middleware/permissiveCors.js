'use strict';

/**
 * PUBLIC_INTERFACE
 * permissiveCorsMiddleware
 * Strictly permissive, non-credentialed CORS for /api/*.
 */
function permissiveCorsMiddleware(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

  const requested = req.headers['access-control-request-headers'];
  const defaultAllowed =
    'Content-Type,Authorization,Accept,x-tenant-id,x-tenant,Origin,User-Agent,Cache-Control,Pragma';
  res.setHeader(
    'Access-Control-Allow-Headers',
    requested && typeof requested === 'string' && requested.trim() !== '' ? requested : defaultAllowed
  );

  res.setHeader('Access-Control-Expose-Headers', 'Content-Type,Content-Length');
  res.setHeader('Access-Control-Max-Age', '600');

  const debug =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.DEBUG || '').toLowerCase() === 'true';
  if (debug && req.path && (req.path === '/api/users' || req.path.startsWith('/api/users'))) {
    // eslint-disable-next-line no-console
    console.log(
      `[CORS][users] origin=${req.headers.origin || 'n/a'} ACRH=${requested || 'n/a'} method=${req.method}`
    );
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }

  return next();
}

module.exports = { permissiveCorsMiddleware };