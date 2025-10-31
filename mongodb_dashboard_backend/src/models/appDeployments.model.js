const mongoose = require('mongoose');

const AppDeploymentsSchema = new mongoose.Schema(
  {
    app_id: { type: String, index: true },
    app_url: { type: String },
    artifact_path: { type: String },
    branch_name: { type: String, index: true },
    build_path: { type: String },
    command: { type: String },
    created_at: { type: Date, required: true, index: true },
    custom_domain: { type: String, default: null },
    deployment_id: { type: String, required: true, unique: true, index: true },
    job_id: { type: String },
    message: { type: String },
    project_id: { type: String, required: true, index: true },
    project_name: { type: String },
    root_path: { type: String },
    status: { type: String, enum: ['success', 'failed', 'in-progress'], index: true },
    subdomain: { type: String },
    task_id: { type: String },
    tenant_id: { type: String, index: true },
    tenant_name: { type: String },
    updated_at: { type: Date, index: true },
    artifact_count: { type: Number },
    domain_status: { type: String, enum: ['verified', 'pending', 'failed'] },
    domain_checked_at: { type: Date, default: null },
  },
  { timestamps: false, collection: 'app_deployments' }
);

// Suggested indexes from schema
AppDeploymentsSchema.index({ project_id: 1, created_at: -1 });
AppDeploymentsSchema.index({ tenant_id: 1, status: 1, updated_at: -1 });
AppDeploymentsSchema.index({ app_id: 1, updated_at: -1 });
AppDeploymentsSchema.index({ branch_name: 1, created_at: -1 });
AppDeploymentsSchema.index(
  { custom_domain: 1 },
  { partialFilterExpression: { custom_domain: { $exists: true, $ne: null } } }
);

module.exports = mongoose.model('AppDeployment', AppDeploymentsSchema);
