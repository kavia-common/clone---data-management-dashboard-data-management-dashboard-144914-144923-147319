'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const User = require('../models/user.model');
const { asyncHandler, success } = require('../utils/http');

const router = express.Router();

/**
 * escapeRegex
 * Escapes special characters in a string for safe use within a RegExp source.
 * Local helper kept minimal to avoid importing extra utilities.
 */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * isPositiveInt
 * Validates that a value is a positive integer.
 */
function isPositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}

/**
 * resolveUserDisplayName
 * Best-effort display name selection from a user document.
 *
 * Preference order:
 * - displayName, display_name
 * - name
 * - full_name, fullName
 * - user_name
 * - email / username as last-resort fallback
 */
function resolveUserDisplayName(userDoc) {
  if (!userDoc || typeof userDoc !== 'object') return null;
  const candidates = [
    userDoc.displayName,
    userDoc.display_name,
    userDoc.name,
    userDoc.full_name,
    userDoc.fullName,
    userDoc.user_name,
    userDoc.email,
    userDoc.username,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

/**
 * buildUsersLookupMap
 * Fetches user documents for a page of llm_costs docs and returns lookup maps for fast enrichment.
 *
 * Strategy:
 * - Primary match key: costs.user_id <-> users._id OR users.user_id
 * - Secondary match key: costs.email <-> users.email
 *
 * @param {Array<object>} rawDocs list of llm_costs docs (lean objects)
 * @returns {Promise<{ byId: Map<string,string>, byEmail: Map<string,string> }>}
 */
async function buildUsersLookupMap(rawDocs) {
  const docs = Array.isArray(rawDocs) ? rawDocs : [];

  const userIds = new Set();
  const emails = new Set();

  for (const d of docs) {
    const uid = d?.user_id;
    if (uid !== undefined && uid !== null && String(uid).trim()) {
      userIds.add(String(uid).trim());
    }
    // Some cost records may contain an email (or nested user info). Use as a secondary join key.
    const email =
      d?.email ||
      d?.user_email ||
      d?.user?.email ||
      d?.user?.user_email ||
      d?.metadata?.email ||
      null;
    if (typeof email === 'string' && email.trim()) {
      emails.add(email.trim().toLowerCase());
    }
  }

  if (userIds.size === 0 && emails.size === 0) {
    return { byId: new Map(), byEmail: new Map() };
  }

  // Only fetch necessary fields. Keep permissive since user docs are heterogeneous.
  const projection = {
    _id: 1,
    user_id: 1,
    email: 1,
    username: 1,
    name: 1,
    displayName: 1,
    display_name: 1,
    full_name: 1,
    fullName: 1,
    user_name: 1,
  };

  // Query users collection with a broad OR to catch the common identifiers.
  const or = [];
  if (userIds.size > 0) {
    const ids = Array.from(userIds);
    or.push({ _id: { $in: ids } });
    or.push({ user_id: { $in: ids } });
  }
  if (emails.size > 0) {
    or.push({ email: { $in: Array.from(emails) } });
  }

  let users = [];
  try {
    users = await User.find({ $or: or }, projection).lean().exec();
  } catch {
    // If user lookup fails for any reason, keep endpoint functional and rely on safe fallbacks.
    return { byId: new Map(), byEmail: new Map() };
  }

  const byId = new Map();
  const byEmail = new Map();

  for (const u of Array.isArray(users) ? users : []) {
    const name = resolveUserDisplayName(u);
    if (!name) continue;

    const idKeys = [];
    if (u?._id !== undefined && u?._id !== null && String(u._id).trim()) {
      idKeys.push(String(u._id).trim());
    }
    if (u?.user_id !== undefined && u?.user_id !== null && String(u.user_id).trim()) {
      idKeys.push(String(u.user_id).trim());
    }
    for (const k of idKeys) {
      if (!byId.has(k)) byId.set(k, name);
    }

    if (typeof u?.email === 'string' && u.email.trim()) {
      const e = u.email.trim().toLowerCase();
      if (!byEmail.has(e)) byEmail.set(e, name);
    }
  }

  return { byId, byEmail };
}

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Returns raw/full documents from the 'llm_costs' collection (underscore), with optional organization_id filter,
 * server-side pagination, and stable default sort by _id desc. Currency strings and nested arrays are preserved as-is.
 *
 * Enrichment:
 * - Adds `user_name` derived by joining against the users collection.
 * - Join keys: costs.user_id -> users._id OR users.user_id, then fallback to costs.email -> users.email.
 * - Preserves all existing response fields and pagination parameters.
 *
 * Response: { success: true, data: [<raw docs + user_name>], meta: { page, limit, total, organization_id? } }
 *
 * Validation and behavior:
 * - page defaults to 1; limit defaults to 10; limit is clamped to maxLimit (100). Non-integer/<=0 cause 400.
 * - organization_id/tenant_id accepted as strings only; non-string values cause 400.
 * - Defensive try/catch around DB operations to avoid 500 on data shape issues; returns consistent 500 payload when unexpected.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Pagination validation with sane defaults and clamped max
    const maxLimit = 100;

    const pageRaw = req.query.page ?? '1';
    const limitRaw = req.query.limit ?? '10';

    if (!isPositiveInt(pageRaw)) {
      return res.status(400).json({ success: false, message: 'Invalid page; must be a positive integer' });
    }
    if (!isPositiveInt(limitRaw)) {
      return res.status(400).json({ success: false, message: 'Invalid limit; must be a positive integer' });
    }

    const page = Math.max(parseInt(pageRaw, 10), 1);
    const limit = Math.min(parseInt(limitRaw, 10), maxLimit);
    const skip = (page - 1) * limit;

    // Optional broadened filter by organization_id (alias: tenant_id)
    const orgParam = req.query.organization_id ?? req.query.tenant_id ?? '';
    if (orgParam !== '' && typeof orgParam !== 'string') {
      return res.status(400).json({ success: false, message: 'organization_id/tenant_id must be a string' });
    }
    const rawOrg = String(orgParam || '').trim();

    const filter = {};
    if (rawOrg) {
      // Build $or across exact and case-insensitive matches on organization_id and tenant_id
      const rx = new RegExp(`^${escapeRegex(rawOrg)}$`, 'i');
      filter.$or = [
        { organization_id: rawOrg },
        { organization_id: { $regex: rx } },
        { tenant_id: rawOrg },
        { tenant_id: { $regex: rx } },
      ];
    }

    // Stable default sort: newest first by _id
    const sort = { _id: -1 };

    // Execute count + page with defensive handling
    let total = 0;
    let rawDocs = [];
    try {
      [total, rawDocs] = await Promise.all([
        LLMCost.countDocuments(filter),
        LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
      ]);
    } catch (err) {
      // If the filter contained something unexpected or model misconfig, surface 400 where appropriate
      const status = /CastError|ObjectId|BSON|E11000|ValidationError/i.test(String(err?.name) + ' ' + String(err?.message))
        ? 400
        : 500;
      return res.status(status).json({
        success: false,
        message: status === 400 ? 'Invalid query parameters or filter' : 'Internal server error',
        details: process.env.NODE_ENV !== 'production' ? String(err?.message || err) : undefined,
      });
    }

    // Build user lookup maps for this page (best-effort, non-fatal on errors)
    const { byId: userNameById, byEmail: userNameByEmail } = await buildUsersLookupMap(rawDocs);

    // Derive agents for each document from nested users[].projects[].agents[] if present
    // - Defensive against missing arrays/fields
    // - Collect unique agent_name values (fallback to name), sorted ascending for stable UI
    // - Also enrich with user_name from users collection (no "Unknown User" if match exists)
    // - Keep backward compatibility by preserving all existing fields
    const docs = Array.isArray(rawDocs)
      ? rawDocs.map((d) => {
          try {
            const usersArr = Array.isArray(d && d.users) ? d.users : [];
            const agentNames = [];

            for (const u of usersArr) {
              const projects = Array.isArray(u && u.projects) ? u.projects : [];
              for (const p of projects) {
                const agents = Array.isArray(p && p.agents) ? p.agents : [];
                for (const a of agents) {
                  const n = (a && (a.agent_name || a.name)) || null;
                  if (typeof n === 'string' && n.trim().length > 0) {
                    agentNames.push(n.trim());
                  }
                }
              }
            }

            // De-duplicate and sort
            const distinctSorted = Array.from(new Set(agentNames)).sort((a, b) =>
              String(a).localeCompare(String(b))
            );

            // Backward compatibility: also expose a single agent_name if only one exists
            // without removing any existing fields.
            const agent_name = distinctSorted.length === 1 ? distinctSorted[0] : d.agent_name || undefined;

            // user_name enrichment:
            // - prefer explicit existing d.user_name if present
            // - else try lookup by user_id
            // - else try lookup by email (if present on cost doc)
            // - else safe fallback (keep previous behavior for unmatched records)
            const existingUserName = typeof d.user_name === 'string' && d.user_name.trim() ? d.user_name.trim() : null;

            const uid = d?.user_id !== undefined && d?.user_id !== null ? String(d.user_id).trim() : '';
            const emailRaw =
              d?.email ||
              d?.user_email ||
              d?.user?.email ||
              d?.user?.user_email ||
              d?.metadata?.email ||
              null;
            const emailKey = typeof emailRaw === 'string' && emailRaw.trim() ? emailRaw.trim().toLowerCase() : '';

            const resolvedUserName =
              existingUserName ||
              (uid && userNameById.get(uid)) ||
              (emailKey && userNameByEmail.get(emailKey)) ||
              'Unknown User';

            // Return with new agents array and optional agent_name (existing fields preserved)
            return {
              ...d,
              user_name: resolvedUserName,
              ...(agent_name ? { agent_name } : {}),
              agents: distinctSorted,
            };
          } catch {
            // On unexpected data shape issues, preserve doc and keep safe fallbacks
            const uid = d?.user_id !== undefined && d?.user_id !== null ? String(d.user_id).trim() : '';
            const resolvedUserName = (uid && userNameById.get(uid)) || d?.user_name || 'Unknown User';
            return { ...d, user_name: resolvedUserName, agents: [] };
          }
        })
      : [];

    // Minimal diagnostic headers
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Total', String(total));
      if (rawOrg) res.setHeader('x-effective-tenant', rawOrg);
      res.setHeader('X-LLM-COSTS-UserEnrichment', 'users collection lookup by user_id/email');
    } catch {}

    // Envelope with raw docs (plus user_name) preserved
    return success(
      res,
      Array.isArray(docs) ? docs : [],
      {
        page,
        limit,
        total,
        ...(rawOrg ? { organization_id: rawOrg } : {}),
      },
      200
    );
  })
);

module.exports = router;
