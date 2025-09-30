const mongoose = require('mongoose');

/**
 * Tenant (organization) model
 * Stores group hierarchy, allocated credits, and user/project associations.
 */
const TenantUserSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    role: { type: String, enum: ['owner', 'admin', 'member', 'viewer'], default: 'member' },
    groups: { type: [String], default: [] }, // group names/ids for navigation trees
  },
  { _id: false }
);

const TenantSchema = new mongoose.Schema(
  {
    tenant_id: { type: String, required: true, unique: true, index: true },
    tenant_name: { type: String, required: true, index: true },
    description: { type: String },

    // Credits at tenant level (can be distributed across projects)
    allocated_credits: { type: Number, default: 0 },
    credits_unit: { type: String, default: 'USD' },

    // Hierarchy and grouping for navigation
    groups: [{ type: String }], // list of group names/ids
    parent_tenant_id: { type: String, default: null, index: true }, // if nested orgs

    // Associations (denormalized listing for quick nav)
    users: { type: [TenantUserSchema], default: [] },
    projects: { type: [String], default: [] }, // list of project_id

    // Audit
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now, index: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    tags: { type: [String], default: [] },
  },
  { timestamps: false, collection: 'tenants', strict: false }
);

TenantSchema.index({ status: 1, created_at: -1 });

TenantSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

module.exports = mongoose.model('Tenant', TenantSchema);
