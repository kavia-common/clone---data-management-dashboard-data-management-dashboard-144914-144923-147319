"use strict";

/**
 * App Deployments controller
 * Minimal implementation to support listing deployments with dynamic tenant filtering.
 * If no data exists, returns an empty list.
 */

const AppDeployment = require("../models/appDeployments.model");
const { resolveOrganizationIdFromRequest } = require("../middleware/tenantScope");

/**
 * Normalize tenant/organization id from query/header/auth.
 * - Prefer Authorization-derived tenant when available through auth middleware (req.auth.tenantId)
 * - Then header: x-organization-id
 * - Then query: tenant_id or organization_id
 * Returns { tenantId, source } where source indicates how it was derived.
 */
function getEffectiveTenantId(req) {
  // Prefer auth-derived tenant if present
  if (req.auth && req.auth.tenantId) {
    return { tenantId: String(req.auth.tenantId), source: "auth" };
  }
  // Header
  const hdr = req.header("x-organization-id");
  if (hdr) return { tenantId: String(hdr), source: "header" };
  // Query aliases
  const q = req.query || {};
  if (q.tenant_id) return { tenantId: String(q.tenant_id), source: "query.tenant_id" };
  if (q.organization_id) return { tenantId: String(q.organization_id), source: "query.organization_id" };
  return { tenantId: null, source: "none" };
}

// PUBLIC_INTERFACE
async function listAppDeployments(req, res, next) {
  /**
   * List application deployments, supports optional pagination and filter.
   * Query parameters:
   *  - tenant_id | organization_id (alias): scopes results when provided or derived from auth/header
   *  - page, limit, sort, filter (JSON string)
   * Returns:
   *  - If page/limit provided: { success, data, meta }
   *  - Else: raw array []
   */
  try {
    const start = Date.now();

    const { tenantId } = getEffectiveTenantId(req);

    // Parse optional filter
    let filter = {};
    if (req.query && req.query.filter) {
      try {
        filter = JSON.parse(req.query.filter);
      } catch (e) {
        return res.status(400).json({ success: false, error: "Invalid filter JSON" });
      }
    }

    // Apply tenant scoping if available
    if (tenantId) {
      // Allow both organization_id and tenant_id fields in collection
      filter.$or = [
        { tenant_id: tenantId },
        { organization_id: tenantId },
      ];
    }

    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(Math.min(limitRaw, 200), 1) : null;

    // Simple sort parsing, e.g. "-created_at" or "created_at"
    let sort = undefined;
    if (req.query && req.query.sort) {
      const s = String(req.query.sort).trim();
      if (s.startsWith("-")) {
        sort = { [s.slice(1)]: -1 };
      } else {
        sort = { [s]: 1 };
      }
    }

    // Build query
    const query = AppDeployment.find(filter);
    if (sort) query.sort(sort);

    if (page && limit) {
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        query.skip(skip).limit(limit).lean().exec(),
        AppDeployment.countDocuments(filter),
      ]);
      res.set("x-effective-tenant", tenantId || "");
      res.set("x-appdeploy-filter", JSON.stringify(filter));
      res.set("x-appdeploy-sort", sort ? JSON.stringify(sort) : "");
      return res.json({
        success: true,
        data: items,
        meta: { page, limit, total, timing_ms: Date.now() - start },
      });
    }

    // If only limit provided (without page), treat as pagination as well
    if (!page && limit) {
      const [items, total] = await Promise.all([
        query.limit(limit).lean().exec(),
        AppDeployment.countDocuments(filter),
      ]);
      res.set("x-effective-tenant", tenantId || "");
      res.set("x-appdeploy-filter", JSON.stringify(filter));
      res.set("x-appdeploy-sort", sort ? JSON.stringify(sort) : "");
      return res.json({
        success: true,
        data: items,
        meta: { page: 1, limit, total, timing_ms: Date.now() - start },
      });
    }

    // Default: raw array
    const items = await query.lean().exec();
    res.set("x-effective-tenant", tenantId || "");
    res.set("x-appdeploy-filter", JSON.stringify(filter));
    res.set("x-appdeploy-sort", sort ? JSON.stringify(sort) : "");
    return res.json(items);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listAppDeployments,
};
