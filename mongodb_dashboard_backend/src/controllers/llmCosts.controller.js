'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Purpose:
 *  - Return documents from llm-costs collection with proper pagination and optional tenant filter.
 *  - Do NOT unwind users here; dedicated per-user listing lives at /api/llm-costs/users.
 *
 * Response fields per document (normalized):
 *  - _id, organization_id, organization_name, organization_cost, users[], projects[], agents[]
 *
 * Query params:
 *  - organization_id (alias tenant_id or x-organization-id header) for scoping
 *  - page (default 1), limit (default 20, max 200)
 *  - sort (defaults to createdAt desc, _id desc). Supports createdAt, timestamp, created_at, _id.
 *
 * Behavior:
 *  - If tenant not resolved from JWT/header/query, returns paginated list across all tenants (demo mode).
 *  - Returns envelope when page/limit present: { success, data, meta:{ page, limit, total } }
 *  - Otherwise returns raw array of documents.
 */
 // PUBLIC_INTERFACE
async function listLLMCosts(req, res, next) {
  try {
    const {
      page: pageRaw,
      limit: limitRaw,
      sort: sortRaw,
      organization_id: orgQuery,
      tenant_id: tenantQuery,
    } = req.query;

    // Resolve tenant scope (JWT via upstream, else header, else query)
    const headerTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      undefined;

    const resolvedTenant = req.tenantId || headerTenant || orgQuery || tenantQuery || undefined;

    // Sort parsing
    let sortStage = {};
    if (sortRaw && typeof sortRaw === 'string' && sortRaw.trim()) {
      sortRaw.split(',').forEach((s) => {
        const v = s.trim();
        if (!v) return;
        if (v.startsWith('-')) sortStage[v.slice(1)] = -1;
        else sortStage[v] = 1;
      });
    }
    if (!Object.keys(sortStage).length) {
      // Prefer createdAt then fallback to timestamp/created_at and always _id desc for stability
      sortStage = { createdAt: -1, timestamp: -1, created_at: -1, _id: -1 };
    }

    // Pagination: default envelope pagination
    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    // Tenant match (optional if not provided/resolved)
    const match = {};
    if (resolvedTenant) {
      const t = String(resolvedTenant);
      match.$or = [
        { organization_id: t },
        { tenant_id: t },
        { organizationId: t },
        { tenantId: t },
        { orgId: t },
        { 'tenant.tenant_id': t },
      ];
    }

    // Build normalized projection fields
    const pipeline = [
      Object.keys(match).length ? { $match: match } : { $match: {} },
      {
        $addFields: {
          organization_id_norm: {
            $ifNull: [
              '$organization_id',
              { $ifNull: ['$organizationId', { $ifNull: ['$tenant_id', { $ifNull: ['$tenantId', { $ifNull: ['$orgId', '$tenant.tenant_id'] }] }] }] }
            ]
          },
          organization_name_norm: {
            $ifNull: [
              '$organization_name',
              { $ifNull: ['$tenant_name', { $ifNull: ['$organization', { $ifNull: ['$tenant.name', null] }] }] }
            ]
          },
          organization_cost_norm: {
            $convert: {
              input: {
                $ifNull: [
                  '$organization_cost',
                  { $ifNull: ['$total_cost', { $ifNull: ['$total', { $ifNull: ['$cost', 0] }] }] }
                ]
              },
              to: 'double',
              onError: 0,
              onNull: 0
            }
          },
          users_norm: { $ifNull: ['$users', []] },
          projects_norm: {
            $cond: [
              { $isArray: '$project' },
              '$project',
              { $ifNull: ['$projects', []] }
            ]
          },
          agents_norm: {
            $cond: [
              { $isArray: '$agents' },
              '$agents',
              { $ifNull: ['$Agents', []] }
            ]
          }
        }
      },
      { $sort: sortStage },
      {
        $project: {
          _id: 1,
          organization_id: '$organization_id_norm',
          organization_name: '$organization_name_norm',
          organization_cost: '$organization_cost_norm',
          users: '$users_norm',
          projects: '$projects_norm',
          agents: '$agents_norm',
          createdAt: 1,
          timestamp: 1,
          created_at: 1
        }
      },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }]
        }
      }
    ];

    const result = await LLMCost.aggregate(pipeline).allowDiskUse(true).exec();
    const data = result?.[0]?.data || [];
    const total = result?.[0]?.totalCount?.[0]?.count || 0;

    // Diagnostics headers
    try {
      if (resolvedTenant) res.set('X-Applied-Tenant', String(resolvedTenant));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
    } catch {}

    // Always return envelope for consistent client experience
    return res.status(200).json({
      success: true,
      data,
      meta: { page, limit, total }
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listLLMCosts,
};
