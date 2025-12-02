'use strict';

const mongoose = require('mongoose');
const { parsePagination, success, failure } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * buildCrudController
 * Robust CRUD controller factory:
 * - Safe filter parsing and sort normalization
 * - Tenant scoping enforcement via req.tenantId (aliases allowed) with Super Admin bypass
 * - Pagination with envelope { success, data, meta }
 * - Defensive aggregation for pagination and non-paginated responses
 *
 * @param {import('mongoose').Model} Model - The Mongoose model
 * @param {string} defaultSort - Default sort string, e.g., '-timestamp' or '-created_at'
 * @returns {{ list: Function, getById: Function, create: Function, update: Function, remove: Function }}
 */
function buildCrudController(Model, defaultSort = '-created_at') {
  // PUBLIC_INTERFACE
  function buildSort(sortStr) {
    const s = (typeof sortStr === 'string' ? sortStr.trim() : '') || '';
    if (!s) return { _id: -1 };
    let dir = 1;
    let field = s;
    if (s.startsWith('-')) { dir = -1; field = s.substring(1); }
    if (s.startsWith('+')) { field = s.substring(1); }
    if (!field) return { _id: -1 };
    return { [field]: dir, _id: -1 };
  }

  // PUBLIC_INTERFACE
  function normalizeSort(sortStr, allowed = ['timestamp', 'created_at', '_id', 'updated_at', 'total_cost']) {
    const s = typeof sortStr === 'string' ? sortStr.trim() : '';
    if (!s) return buildSort(defaultSort);
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    const order = {};
    for (const part of parts) {
      let dir = 1;
      let field = part;
      if (part.startsWith('-')) {
        dir = -1;
        field = part.substring(1);
      } else if (part.startsWith('+')) {
        field = part.substring(1);
      }
      if (allowed.includes(field)) {
        order[field] = dir;
      }
    }
    if (Object.keys(order).length === 0) {
      return buildSort(defaultSort);
    }
    return order;
  }

  function mergeFilterWithTenant(filter, tenantId) {
    const f = filter && typeof filter === 'object' ? { ...filter } : {};
    delete f.tenant_id;
    delete f.tenantId;
    delete f.organization_id;
    delete f.organizationId;
    delete f.orgId;
    if (!tenantId) { return f; }
    const normalizedTenantFilter = {
      $or: [
        { tenant_id: String(tenantId) },
        { organization_id: String(tenantId) },
        { orgId: String(tenantId) },
        { tenantId: String(tenantId) },
        { organizationId: String(tenantId) },
        { 'tenant.tenant_id': String(tenantId) },
      ],
    };
    return Object.keys(f).length > 0 ? { $and: [f, normalizedTenantFilter] } : normalizedTenantFilter;
  }

  function isLLMCostModel() {
    return Model?.collection?.name === 'llm-costs' || Model?.modelName === 'LLMCost';
  }

  // PUBLIC_INTERFACE
  async function list(req, res) {
    let parsedFilter = {};
    if (typeof req.query?.filter === 'string' && req.query.filter.trim() !== '') {
      try {
        parsedFilter = JSON.parse(req.query.filter);
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }

    try {
      if (parsedFilter && typeof parsedFilter === 'object') {
        delete parsedFilter.tenant_id;
        delete parsedFilter.tenantId;
        delete parsedFilter.organization_id;
        delete parsedFilter.organizationId;
        delete parsedFilter.orgId;
      }
    } catch {}

    const bypass = !!(req.tenantScopeDisabled || req.allTenants);
    if (!bypass && !req.tenantId) {
      const hdrOrg =
        (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
        (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
        (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
        '';
      const qOrg =
        (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
        (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        '';
      if (hdrOrg || qOrg) {
        req.tenantId = String(hdrOrg || qOrg);
      }
    }

    const hasAuthHeader = !!req.headers?.authorization;
    const clientRequestedTenant =
      (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      '';

    if (!bypass && hasAuthHeader && clientRequestedTenant && String(clientRequestedTenant) !== String(req.tenantId || '')) {
      return failure(res, 'Forbidden: tenant scope mismatch', 403);
    }

    if (!bypass && !req.tenantId) {
      return failure(
        res,
        'Missing tenant scope: pass x-organization-id header or ?tenant_id / ?organization_id. For Super Admin all tenants, use T0000 or x-all-tenants=true.',
        400
      );
    }

    const isLLM = isLLMCostModel();
    let filter = parsedFilter || {};
    if (isLLM) {
      const { page, limit: parsedLimit, skip, explicit } = parsePagination(req.query);
      const hasExplicitPagination = explicit;

      const filterKeys = filter && typeof filter === 'object' ? Object.keys(filter) : [];
      const hasExplicitDate =
        filterKeys.some((k) => ['timestamp', 'created_at', 'createdAt', 'date', 'updated_at', 'updatedAt'].includes(k)) ||
        typeof req.query?.from === 'string' ||
        typeof req.query?.to === 'string';

      if (!hasExplicitPagination && !hasExplicitDate) {
        const now = new Date();
        const from = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        const defaultDateFilter = {
          $or: [
            { timestamp: { $gte: from, $lte: now } },
            { created_at: { $gte: from, $lte: now } },
          ],
        };
        filter = Object.keys(filter).length ? { $and: [filter, defaultDateFilter] } : defaultDateFilter;
        try { res.set('X-Default-Date-Window', 'last-14-days'); } catch {}
      }
    }

    const appliedFilter = (req.tenantScopeDisabled || req.allTenants) ? (filter && typeof filter === 'object' ? filter : {}) : mergeFilterWithTenant(filter, req.tenantId);

    try {
      const appliedFilterStr = JSON.stringify(appliedFilter);
      res.set('X-Applied-Filter', appliedFilterStr);
      if (req.tenantId) res.set('X-Applied-Tenant', String(req.tenantId));
      if (Model?.collection?.name) res.set('X-Model-Collection', Model.collection.name);
    } catch {}

    const allowedSorts = isLLM
      ? ['timestamp', 'created_at', '_id', 'updated_at', 'total_cost']
      : ['timestamp', 'created_at', '_id', 'updated_at'];
    const sortObj = normalizeSort(req.query?.sort, allowedSorts);

    const { page, limit, skip, explicit } = parsePagination(req.query);
    const hasPagination = explicit && Number.isInteger(page) && page > 0 && Number.isInteger(limit) && limit > 0 && limit <= 200;

    try {
      if (hasPagination) {
        const sortStage = Object.keys(sortObj).length
          ? Object.fromEntries(Object.entries(sortObj))
          : { timestamp: -1, _id: -1 };

        // For llm-costs use $facet for total and page slice
        if (isLLM) {
          const pipeline = [
            { $match: appliedFilter || {} },
            { $addFields: {
                timestamp: { $ifNull: ['$timestamp', '$created_at'] },
                organization_id: { $ifNull: ['$organization_id', '$tenant_id'] },
                numeric_total_cost: {
                  $convert: {
                    input: {
                      $replaceAll: {
                        input: { $toString: { $ifNull: ['$total_cost', 0] } },
                        find: '$',
                        replacement: ''
                      }
                    },
                    to: 'double',
                    onError: 0,
                    onNull: 0
                  }
                }
              }
            },
            {
              $facet: {
                items: [
                  { $sort: sortStage },
                  { $skip: skip },
                  { $limit: limit },
                  {
                    $project: {
                      _id: 1,
                      tenant_id: 1,
                      organization_id: 1,
                      user_id: 1,
                      project_id: 1,
                      llm_model: 1,
                      provider: 1,
                      service_type: 1,
                      operation: 1,
                      total_cost: 1,
                      numeric_total_cost: 1,
                      timestamp: 1,
                      created_at: 1,
                      updated_at: 1,
                      'breakdown.input_tokens': 1,
                      'breakdown.output_tokens': 1
                    }
                  }
                ],
                totalCount: [{ $count: 'count' }],
              }
            },
          ];
          const agg = await Model.aggregate(pipeline).allowDiskUse(true);
          const first = Array.isArray(agg) && agg[0] ? agg[0] : { items: [], totalCount: [] };
          const items = first.items || [];
          const total = Array.isArray(first.totalCount) && first.totalCount[0] ? (first.totalCount[0].count || 0) : 0;
          return res.status(200).json({ success: true, data: items, meta: { page, limit, total } });
        }

        const total = await Model.countDocuments(appliedFilter);
        const items = await Model.find(appliedFilter)
          .sort(sortObj)
          .skip(skip)
          .limit(limit)
          .allowDiskUse?.(true)
          .lean();
        return res.status(200).json({ success: true, data: items, meta: { page, limit, total } });
      }

      // Non-paginated path
      if (isLLM) {
        const sortStage = Object.keys(sortObj).length
          ? (sortObj)
          : { timestamp: -1, _id: -1 };
        const pipeline = [
          { $match: appliedFilter || {} },
          { $addFields: {
              timestamp: { $ifNull: ['$timestamp', '$created_at'] },
              organization_id: { $ifNull: ['$organization_id', '$tenant_id'] },
              numeric_total_cost: {
                $convert: {
                  input: {
                    $replaceAll: {
                      input: { $toString: { $ifNull: ['$total_cost', 0] } },
                      find: '$',
                      replacement: ''
                    }
                  },
                  to: 'double',
                  onError: 0,
                  onNull: 0
                }
              }
            }
          },
          { $sort: sortStage },
          {
            $project: {
              _id: 1,
              tenant_id: 1,
              organization_id: 1,
              user_id: 1,
              project_id: 1,
              llm_model: 1,
              provider: 1,
              service_type: 1,
              operation: 1,
              total_cost: 1,
              numeric_total_cost: 1,
              timestamp: 1,
              created_at: 1,
              updated_at: 1,
              'breakdown.input_tokens': 1,
              'breakdown.output_tokens': 1
            }
          }
        ];
        const items = await Model.aggregate(pipeline).allowDiskUse(true);
        return res.status(200).json(items);
      }

      const items = await Model.find(appliedFilter).sort(sortObj).allowDiskUse?.(true).lean();
      return res.status(200).json(items);
    } catch (err) {
      const code = (err && (err.status || err.statusCode)) || 500;
      if (code === 500) {
        return res.status(500).json({
          success: false,
          message: 'Internal server error while listing documents',
          error: err?.message || 'Unknown error',
        });
      }
      return res.status(code).json({ success: false, message: err?.message || 'Request failed' });
    }
  }

  // PUBLIC_INTERFACE
  async function getById(req, res) {
    try {
      const { id } = req.params;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid id' });
      }
      const bypass = !!(req.tenantScopeDisabled || req.allTenants);
      const match = bypass
        ? { _id: id }
        : {
            _id: id,
            $or: [
              { tenant_id: String(req.tenantId) },
              { organization_id: String(req.tenantId) },
              { orgId: String(req.tenantId) },
              { tenantId: String(req.tenantId) },
              { organizationId: String(req.tenantId) },
              { 'tenant.tenant_id': String(req.tenantId) },
            ],
          };
      const doc = await Model.findOne(match).lean();
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      return success(res, doc);
    } catch (err) {
      const code = err?.status || err?.statusCode || 500;
      return res.status(code).json({ success: false, message: err?.message || 'Internal Server Error' });
    }
  }

  // PUBLIC_INTERFACE
  async function create(req, res) {
    try {
      const body = req?.stampTenant ? req.stampTenant({ ...(req.body || {}) }) : (req.body || {});
      const clean = body && typeof body === 'object' ? { ...body } : null;
      if (!clean) return failure(res, 'Bad request: payload must be an object', 400);
      delete clean.tenantId;
      delete clean.organizationId;
      delete clean.orgId;
      const created = await Model.create(clean);
      return res.status(201).json(created);
    } catch (err) {
      const code = err?.status || err?.statusCode || 400;
      return res.status(code).json({ success: false, message: err?.message || 'Bad Request' });
    }
  }

  // PUBLIC_INTERFACE
  async function update(req, res) {
    try {
      const { id } = req.params;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid id' });
      }
      const body = req?.stampTenant ? req.stampTenant({ ...(req.body || {}) }) : (req.body || {});
      delete body?.tenantId;
      delete body?.organizationId;
      delete body?.orgId;
      const bypass = !!(req.tenantScopeDisabled || req.allTenants);
      const match = bypass
        ? { _id: id }
        : {
            _id: id,
            $or: [
              { tenant_id: String(req.tenantId) },
              { organization_id: String(req.tenantId) },
              { orgId: String(req.tenantId) },
              { tenantId: String(req.tenantId) },
              { organizationId: String(req.tenantId) },
              { 'tenant.tenant_id': String(req.tenantId) },
            ],
          };
      const updated = await Model.findOneAndUpdate(match, body, { new: true, runValidators: false }).lean();
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      return success(res, updated);
    } catch (err) {
      const code = err?.status || err?.statusCode || 400;
      return res.status(code).json({ success: false, message: err?.message || 'Invalid id or payload' });
    }
  }

  // PUBLIC_INTERFACE
  async function remove(req, res) {
    try {
      const { id } = req.params;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid id' });
      }
      const bypass = !!(req.tenantScopeDisabled || req.allTenants);
      const match = bypass
        ? { _id: id }
        : {
            _id: id,
            $or: [
              { tenant_id: String(req.tenantId) },
              { organization_id: String(req.tenantId) },
              { orgId: String(req.tenantId) },
              { tenantId: String(req.tenantId) },
              { organizationId: String(req.tenantId) },
              { 'tenant.tenant_id': String(req.tenantId) },
            ],
          };
      const deleted = await Model.findOneAndDelete(match).lean();
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      return success(res, deleted);
    } catch (err) {
      const code = err?.status || err?.statusCode || 400;
      return res.status(code).json({ success: false, message: err?.message || 'Invalid id' });
    }
  }

  return { list, getById, create, update, remove };
}

module.exports = { buildCrudController };
