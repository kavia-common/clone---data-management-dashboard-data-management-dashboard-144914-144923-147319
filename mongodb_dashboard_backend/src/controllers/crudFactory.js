const { parsePagination, success, failure } = require('../utils/http');

/**
 * Build a REST controller for a Mongoose model.
 * Supports list with basic filtering, get by id, create, update, delete.
 */
function buildCrudController(Model, listDefaultSort = '-_id') {
  return {
    // PUBLIC_INTERFACE
    async list(req, res) {
      /** List documents with basic JSON filter, pagination, and sort */
      const { page, limit, skip } = parsePagination(req.query);
      const filterRaw = req.query.filter ? req.query.filter : '{}';
      let filter = {};
      try {
        filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
      } catch (err) {
        return failure(res, 'Invalid filter JSON', 400);
      }
      const sort = req.query.sort || listDefaultSort;
      const [items, total] = await Promise.all([
        Model.find(filter).sort(sort).skip(skip).limit(limit),
        Model.countDocuments(filter),
      ]);
      return success(res, items, { page, limit, total }, 200);
    },

    // PUBLIC_INTERFACE
    async getById(req, res) {
      /** Get a single document by Mongo _id */
      const { id } = req.params;
      const doc = await Model.findById(id);
      if (!doc) return failure(res, 'Not found', 404);
      return success(res, doc);
    },

    // PUBLIC_INTERFACE
    async create(req, res) {
      /** Create a new document */
      const data = req.body;
      const doc = await Model.create(data);
      return success(res, doc, undefined, 201);
    },

    // PUBLIC_INTERFACE
    async update(req, res) {
      /** Update a document by _id with provided data */
      const { id } = req.params;
      const data = req.body;
      const doc = await Model.findByIdAndUpdate(id, data, { new: true });
      if (!doc) return failure(res, 'Not found', 404);
      return success(res, doc);
    },

    // PUBLIC_INTERFACE
    async remove(req, res) {
      /** Delete a document by _id */
      const { id } = req.params;
      const doc = await Model.findByIdAndDelete(id);
      if (!doc) return failure(res, 'Not found', 404);
      return success(res, { _id: id });
    },
  };
}

module.exports = { buildCrudController };
