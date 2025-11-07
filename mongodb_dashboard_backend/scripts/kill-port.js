#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * kill-port
 * Utility to terminate any process listening on a given TCP port.
 * Usage: node scripts/kill-port.js <port> [--force]
 * - Tries lsof if available, falls back to ss.
 * - Only kills Node.js processes by default; use --force to kill any process.
 *
 * This is used by npm run dev to avoid EADDRINUSE in preview environments where
 * a stale nodemon/node process may be left running.
 */
const { execSync } = require('node:child_process');

function getPids(port) {
  const pids = new Set();

  try {
    const out = execSync(`lsof -i :${port} -sTCP:LISTEN -n -P || true`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')
      .slice(1);
    for (const line of out) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 2) {
        const cmd = cols[0];
        const pid = parseInt(cols[1], 10);
        if (!Number.isNaN(pid)) {
          pids.add(`${cmd}:${pid}`);
        }
      }
    }
  } catch {}
  if (pids.size === 0) {
    try {
      const out = execSync(`ss -ltnp | grep :${port} || true`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
        .split('\n');
      for (const line of out) {
        const m = line.match(/pid=(\\d+),.*\\\"([^\\"]+)\\\"/);
        if (m) {
          const pid = parseInt(m[1], 10);
          const cmd = m[2] || 'proc';
          if (!Number.isNaN(pid)) {
            pids.add(`${cmd}:${pid}`);
          }
        }
      }
    } catch {}
  }
  return Array.from(pids);
}

function main() {
  const port = parseInt(process.argv[2] || '', 10);
  const force = process.argv.includes('--force');
  if (!port || Number.isNaN(port)) {
    console.error('[kill-port] usage: node scripts/kill-port.js <port> [--force]');
    process.exit(0);
  }
  const entries = getPids(port);
  if (entries.length === 0) {
    console.log(`[kill-port] no listeners on ${port}`);
    return;
  }
  for (const entry of entries) {
    const [cmd, pidStr] = entry.split(':');
    const pid = parseInt(pidStr, 10);
    if (!pid) continue;
    if (!force && !/^node/.test(cmd)) {
      console.log(`[kill-port] skipping non-node process ${cmd} (pid ${pid}) on ${port}. Use --force to kill.`);
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[kill-port] sent SIGTERM to ${cmd} (pid ${pid}) on ${port}`);
    } catch (e) {
      console.warn(`[kill-port] failed to SIGTERM pid ${pid}: ${e.message}`);
    }
  }

  // brief wait
  setTimeout(() => {
    const still = getPids(port);
    if (still.length === 0) {
      console.log(`[kill-port] port ${port} is free`);
      process.exit(0);
    }
    for (const entry of still) {
      const [cmd, pidStr] = entry.split(':');
      const pid = parseInt(pidStr, 10);
      if (!pid) continue;
      if (!force && !/^node/.test(cmd)) continue;
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`[kill-port] sent SIGKILL to ${cmd} (pid ${pid}) on ${port}`);
      } catch (e) {
        console.warn(`[kill-port] failed to SIGKILL pid ${pid}: ${e.message}`);
      }
    }
    console.log(`[kill-port] completed`);
    process.exit(0);
  }, 300);
}

main();
