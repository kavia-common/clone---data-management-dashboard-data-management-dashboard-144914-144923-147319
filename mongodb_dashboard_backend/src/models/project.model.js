const mongoose = require('mongoose');

/**
 * Project model
 * Captures project ownership, access details, and credit allocation.
 */
const ProjectAccessSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    role: { type: String, enum: ['owner', 'admin', 'member', 'viewer'], default: 'member' },
    access_level: { type: String, enum: ['read', 'write', 'admin'], default: 'read' },
  },
  { _id: false }
);

const ProjectSchema = new mongoose.Schema(
  {
    tenant_id: { type: String, required: true, index: true },
    project_id: { type: String, required: true, unique: true, index: true },
    project_name: { type: String, required: true, index: true },
    description: { type: String },

    // Ownership and access
    owner_user_id: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    access_users: { type: [ProjectAccessSchema], default: [] },

    // Credits
    allocated_credits: { type: Number, default: 0 },
    credits_unit: { type: String, default: 'USD' }, // can be adjusted if using credits vs currency

    // Audit
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now, index: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    tags: { type: [String], default: [] },
  },
  { timestamps: false, collection: 'projects', strict: false }
);

// Useful indexes
ProjectSchema.index({ tenant_id: 1, status: 1, created_at: -1 });
ProjectSchema.index({ 'access_users.user_id': 1 });

ProjectSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

module.exports = mongoose.model('Project', ProjectSchema);
