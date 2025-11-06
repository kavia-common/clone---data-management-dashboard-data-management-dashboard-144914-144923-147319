'use strict';

const mongoose = require('mongoose');
const { Schema, model } = mongoose;

/**
 * PUBLIC_INTERFACE
 * Minimal Tenant model
 * - Supports tenant navigation and auth salt fields.
 * - Collection: 'tenants'
 */
const tenantSchema = new Schema(
  {
    tenant_id: { type: String, index: true, unique: false },
    tenant_name: { type: String },
    description: { type: String },
    orgSalt: { type: String, default: null }, // per-tenant salt used by auth utils
    allocated_credits: { type: Number, default: 0 },
    credits_unit: { type: String, default: 'USD' },
    groups: [String],
    users: [Schema.Types.Mixed],
    projects: [String],
    status: { type: String, default: 'active' },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'tenants' }
);

module.exports = model('Tenant', tenantSchema);
