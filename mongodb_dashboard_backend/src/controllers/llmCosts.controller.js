'use strict';

const LlmCost = require('../models/llmCosts.model');
const { parseSort } = require('../utils/string');
const mongoose = require('mongoose');

// PUBLIC_INTERFACE
async function list(req, res) {
  try {
    // If DB is not connected and this is a potentially heavy list, fast 503
    const ready = mongoose.connection.readyState;
    const dbConnected = ready === 1;
    if (!dbConnected) {
      return res.status(503).json({ error: 'Database not connected', code: 'DB_UNAVAILABLE' });
    }

    const { page, limit, sort, filter } = req.query;
    let q = {};
    if (filter) {
      try {
        q = JSON.parse(filter);
      } catch {
        return res.status(400).json({ error: 'Invalid filter' });
      }
    }

    const options = {};
    const sortObj = parseSort(sort);
    if (sortObj) options.sort = sortObj;

    const pageNum = page ? parseInt(page, 10) : null;
    const limitNum = limit ? parseInt(limit, 10) : null;

    if (pageNum && limitNum) {
      const skip = (pageNum - 1) * limitNum;
      const [items, total] = await Promise.all([
        LlmCost.find(q, null, { ...options, skip, limit: limitNum }),
        LlmCost.countDocuments(q),
      ]);
      return res.json({
        success: true,
        data: items,
        meta: { page: pageNum, limit: limitNum, total },
      });
    }

    const items = await LlmCost.find(q, null, options);
    return res.json(items);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  list,
};
