'use strict';

/**
 * PUBLIC_INTERFACE
 * getTenantCollection wraps a MongoDB collection to automatically apply tenant scoping
 * for reads and writes based on req.auth.tenantId.
 *
 * Usage:
 *   const coll = getTenantCollection(req, db.collection('users'));
 *   await coll.find({ status: 'active' }).toArray();
 *
 * Wrapped methods:
 * - find(filter, options)
 * - findOne(filter, options)
 * - insertOne(doc, options)
 * - insertMany(docs, options)
 * - updateOne(filter, update, options)
 * - updateMany(filter, update, options)
 * - deleteOne(filter, options)
 * - deleteMany(filter, options)
 * - aggregate(pipeline, options) -> prepends tenant $match
 */
const { withTenantFilter, enforceTenantOnDoc, enforceTenantOnUpdate, tenantMatchStage } = require('./tenantFilter');

function getTenantCollection(req, collection) {
  if (!req.auth || !req.auth.tenantId) {
    throw new Error('Missing tenant context');
  }

  return {
    // Read ops
    find(filter = {}, options = {}) {
      const scoped = withTenantFilter(req, filter);
      return collection.find(scoped, options);
    },
    findOne(filter = {}, options = {}) {
      const scoped = withTenantFilter(req, filter);
      return collection.findOne(scoped, options);
    },

    // Insert ops
    insertOne(doc = {}, options = {}) {
      const enforced = enforceTenantOnDoc(req, doc);
      return collection.insertOne(enforced, options);
    },
    insertMany(docs = [], options = {}) {
      if (!Array.isArray(docs)) throw new Error('docs must be an array');
      const enforced = docs.map((d) => enforceTenantOnDoc(req, d));
      return collection.insertMany(enforced, options);
    },

    // Update ops
    updateOne(filter = {}, update = {}, options = {}) {
      const scoped = withTenantFilter(req, filter);
      const enforced = enforceTenantOnUpdate(req, update);
      return collection.updateOne(scoped, enforced, options);
    },
    updateMany(filter = {}, update = {}, options = {}) {
      const scoped = withTenantFilter(req, filter);
      const enforced = enforceTenantOnUpdate(req, update);
      return collection.updateMany(scoped, enforced, options);
    },
    findOneAndUpdate(filter = {}, update = {}, options = {}) {
      const scoped = withTenantFilter(req, filter);
      const enforced = enforceTenantOnUpdate(req, update);
      return collection.findOneAndUpdate(scoped, enforced, options);
    },

    // Delete ops
    deleteOne(filter = {}, options = {}) {
      const scoped = withTenantFilter(req, filter);
      return collection.deleteOne(scoped, options);
    },
    deleteMany(filter = {}, options = {}) {
      const scoped = withTenantFilter(req, filter);
      return collection.deleteMany(scoped, options);
    },

    // Aggregate
    aggregate(pipeline = [], options = {}) {
      if (!Array.isArray(pipeline)) throw new Error('pipeline must be an array');
      const headMatch = tenantMatchStage(req, {});
      const finalPipeline = [headMatch, ...pipeline];
      return collection.aggregate(finalPipeline, options);
    },

    // Allow passthrough for other collection methods if needed
    _raw() {
      return collection;
    },
  };
}

module.exports = { getTenantCollection };
