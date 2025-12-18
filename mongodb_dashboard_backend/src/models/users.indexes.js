'use strict';

const mongoose = require('mongoose');
const User = require('./user.model');

/**
 * PUBLIC_INTERFACE
 * ensureUsersIndexes
 * Ensures critical indexes exist for performant tenant-scoped queries on users.
 * This file is safe to require on startup; it will not block server readiness.
 *
 * Indexes added:
 * - tenant_id (sparse)
 * - organization_id (sparse)
 * - compound (tenant_id, created_at)
 * - compound (organization_id, created_at)
 * - optional name index for quick text-ish searches (sparse)
 */
async function ensureUsersIndexes() {
  try {
    const collection = User.collection;
    if (!collection) {
      console.warn('[users.indexes] User collection not available yet.');
      return;
    }

    // Create if missing – use try/catch per index so one failure won't abort the rest
    const createIfMissing = async (spec, options = {}) => {
      try {
        await collection.createIndex(spec, options);
        // eslint-disable-next-line no-console
        console.log('[users.indexes] ensured index:', JSON.stringify({ spec, options }));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[users.indexes] createIndex warning:', e?.message || e);
      }
    };

    await createIfMissing({ tenant_id: 1 }, { name: 'tenant_id_idx', sparse: true, background: true });
    await createIfMissing({ organization_id: 1 }, { name: 'organization_id_idx', sparse: true, background: true });
    await createIfMissing({ tenant_id: 1, created_at: -1 }, { name: 'tenant_created_desc', sparse: true, background: true });
    await createIfMissing({ organization_id: 1, created_at: -1 }, { name: 'org_created_desc', sparse: true, background: true });
    // Optional assist for name-based UI usage; sparse keeps flexibility
    await createIfMissing({ name: 1 }, { name: 'name_idx', sparse: true, background: true });

  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[users.indexes] ensureUsersIndexes warning:', err?.message || err);
  }
}

module.exports = { ensureUsersIndexes };
