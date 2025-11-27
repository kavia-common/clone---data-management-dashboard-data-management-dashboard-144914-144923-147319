'use strict';

const mongoose = require('mongoose');
const { Schema, model } = mongoose;

/**
 * PUBLIC_INTERFACE
 * Minimal AppDeployment model
 * - Supports project name resolution and CRUD.
 * - Collection: 'app_deployments'
 */
const appDeploymentSchema = new Schema(
  {
    tenant_id: { type: String, index: true },
    tenant_name: { type: String },
    project_id: { type: String, index: true },
    
    project_name: { type: String },
    metadata: Schema.Types.Mixed,
    project: Schema.Types.Mixed, // may contain { id, name }
    app_id: { type: String },
    app_url: { type: String },
    artifact_path: { type: String },
    branch_name: { type: String },
    build_path: { type: String },
    command: { type: String },
    deployment_id: { type: String },
    job_id: { type: String },
    message: { type: String },
    status: { type: String, default: 'success' },
    subdomain: { type: String },
    root_path: { type: String },
    status: { type: String, enum: ['success', 'failed', 'in-progress'], index: true },
    subdomain: { type: String },
    task_id: { type: String },
    tenant_id: { type: String, required: true, index: true },
    tenant_name: { type: String },
    updated_at: { type: Date, index: true },
    artifact_count: { type: Number },
    domain_status: { type: String, enum: ['verified', 'pending', 'failed'] },
    domain_checked_at: { type: Date, default: null },
  },
  { timestamps: false, collection: 'app_deployments' }
);

 // Suggested and enforced indexes
appDeploymentSchema.index({ project_id: 1, created_at: -1 });
appDeploymentSchema.index({ tenant_id: 1 });
appDeploymentSchema.index({ tenant_id: 1, project_id: 1 });
appDeploymentSchema.index({ tenant_id: 1, status: 1, updated_at: -1 });
appDeploymentSchema.index({ app_id: 1, updated_at: -1 });
appDeploymentSchema.index({ branch_name: 1, created_at: -1 });
appDeploymentSchema.index(
  { custom_domain: 1 },
  { partialFilterExpression: { custom_domain: { $exists: true, $ne: null } } }
);

module.exports = model('AppDeployment', appDeploymentSchema);
