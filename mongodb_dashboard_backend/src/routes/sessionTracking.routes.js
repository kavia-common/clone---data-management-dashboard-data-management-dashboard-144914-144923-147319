const express = require('express');
const router = express.Router();
const sessionTrackingModel = require('../models/sessionTracking.model');
const { parseQueryFilter } = require('../utils/aggregation.utils');
const { withEnvelope } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * @openapi
 * /api/session-tracking:
 *   get:
 *     summary: List session tracking records
 *     description: |
 *       Returns a list of session tracking documents, filtered by canonical date range parameters (`start` and `end`, both inclusive).
 *       Legacy parameters (`from`, `to`) are ignored when both `start` and `end` are present. For pagination, `page` and `limit` are optional and default to safe values.
 *     tags:
 *       - SessionTracking
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO start datetime (inclusive)
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO end datetime (inclusive)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         required: false
 *         description: Optional page number (default 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 20
 *         required: false
 *         description: Optional page size (default 20, max 200)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *         description: Sort string (e.g., -created_at)
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *         description: JSON filter (e.g., {"tenant_id":"org1","status":"active"})
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search across multiple fields.
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         deprecated: true
 *         description: Legacy param. Ignored if `start` and `end` are present.
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         deprecated: true
 *         description: Legacy param. Ignored if `start` and `end` are present.
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *         deprecated: true
 *         description: Deprecated alias for \"limit\" (not recommended)
 *     responses:
 *       200:
 *         description: Successful response (array or envelope based on pagination params)
 *       400:
 *         description: Invalid filter
 */

router.get('/', async (req, res, next) => {
  try {
    let { page, limit, pageSize, sort, filter, q } = req.query;

    // Fallback for pageSize alias (deprecated)
    if (!limit && pageSize) limit = pageSize;

    // Parse filter JSON if provided
    let find = {};
    if (filter) {
      try {
        find = parseQueryFilter(filter);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid filter JSON' });
      }
    }

    // Text search support
    if (q) {
      find.$or = [
        { task_id: { $regex: q, $options: 'i' } },
        { tenant_id: { $regex: q, $options: 'i' } },
        { organization_name: { $regex: q, $options: 'i' } },
        { user_name: { $regex: q, $options: 'i' } },
        { project_id: { $regex: q, $options: 'i' } },
        { container_id: { $regex: q, $options: 'i' } },
        { service_type: { $regex: q, $options: 'i' } },
        { status: { $regex: q, $options: 'i' } },
        { 'session_data.session_name': { $regex: q, $options: 'i' } },
        { 'session_data.description': { $regex: q, $options: 'i' } },
        { 'session_data.llm_model': { $regex: q, $options: 'i' } }
      ];
    }

    // Date range filtering: Canonical is start/end. Ignore from/to if start and end present.
    const { from, to, start, end } = req.query;
    if (typeof start !== 'undefined' && typeof end !== 'undefined') {
      // Canonical: only use start/end if both present (ignore from/to)
      find.session_start = { $gte: new Date(start), $lte: new Date(end) };
    } else if (typeof from !== 'undefined' && typeof to !== 'undefined') {
      // Legacy: only used if start/end not present
      find.session_start = { $gte: new Date(from), $lte: new Date(to) };
    }
    // If neither provided, do not filter by session_start

    // Pagination defaults
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 20;

    // Find and sort
    sort = sort || '-session_start';

    // Apply pagination if requested, else return array
    const skip = (page - 1) * limit;
    let data, total;
    if ('page' in req.query || 'limit' in req.query || 'pageSize' in req.query) {
      data = await sessionTrackingModel.find(find).sort(sort).skip(skip).limit(limit).lean();
      total = await sessionTrackingModel.countDocuments(find);
      res.json({
        success: true,
        data,
        meta: {
          page,
          limit,
          total
        }
      });
    } else {
      data = await sessionTrackingModel.find(find).sort(sort).lean();
      res.json(data);
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
