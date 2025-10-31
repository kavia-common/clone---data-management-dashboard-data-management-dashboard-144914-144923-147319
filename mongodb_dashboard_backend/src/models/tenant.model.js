const mongoose = require('mongoose');
const crypto = require('crypto');

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

    // Per-organization dynamic salt for password hashing (v2)
    // orgSalt is required for new tenants. For legacy tenants, a pre-save hook will populate it safely.
    orgSalt: { type: String, required: true },
    orgSaltVersion: { type: Number, default: 1 },

    // Audit
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now, index: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    tags: { type: [String], default: [] },
  },
  { timestamps: false, collection: 'tenants', strict: false }
);

TenantSchema.index({ status: 1, created_at: -1 });

// Ensure updated_at is current on updates
TenantSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

/**
 * Ensure orgSalt exists before validation to satisfy required:true on creation.
 * Also set orgSaltVersion default (1) when not present.
 */
TenantSchema.pre('validate', function (next) {
  if (!this.orgSalt || typeof this.orgSalt !== 'string' || this.orgSalt.trim() === '') {
    this.orgSalt = crypto.randomBytes(32).toString('base64');
  }
  if (!this.orgSaltVersion) {
    this.orgSaltVersion = 1;
  }
  next();
});

// Generate per-organization salt on creation if missing (safety net).
// Uses 32 random bytes -> base64 string (not URL-safe intentionally, stored internally and never exposed).
TenantSchema.pre('save', function (next) {
  if (!this.orgSalt || typeof this.orgSalt !== 'string' || this.orgSalt.trim() === '') {
    this.orgSalt = crypto.randomBytes(32).toString('base64');
  }
  if (!this.orgSaltVersion) {
    this.orgSaltVersion = 1;
  }
  next();
});

module.exports = mongoose.model('Tenant', TenantSchema);
