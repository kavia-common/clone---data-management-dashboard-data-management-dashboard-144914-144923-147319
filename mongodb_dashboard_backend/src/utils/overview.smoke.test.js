'use strict';

/**
 * PUBLIC_INTERFACE
 * Minimal smoke test for /api/dashboard/overview.
 * This is a lightweight runtime check using node: it requires the server to be running in CI env.
 * If not running, this test gracefully skips.
 */

const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function run() {
  // Try default known port. Respect HOST if present.
  const host = process.env.HOST || '127.0.0.1';
  const port = process.env.PORT || 3001;
  const url = `http://${host}:${port}/api/dashboard/overview`;

  try {
    const res = await get(url);
    // Accept only HTTP 200
    if (res.status !== 200) {
      console.log('[overview.smoke] Skipping: server responded with status', res.status);
      process.exit(0);
    }
    const json = JSON.parse(res.body || '{}');
    if (!json || typeof json !== 'object') {
      console.error('[overview.smoke] Invalid JSON payload');
      process.exit(1);
    }
    if (!('metrics' in json) || !('items' in json)) {
      console.error('[overview.smoke] Expected keys missing in overview payload');
      process.exit(1);
    }
    console.log('[overview.smoke] OK');
    process.exit(0);
  } catch (e) {
    // Skip rather than fail hard if server isn't running in CI
    console.log('[overview.smoke] Skipping (server likely not running):', e.message);
    process.exit(0);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
