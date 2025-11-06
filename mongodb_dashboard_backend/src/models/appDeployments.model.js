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
    projectName: { type: String },
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
    artifact_count: { type: Number, default: 0 },
    domain_status: { type: String, default: null },
    domain_checked_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'app_deployments' }
);

module.exports = model('AppDeployment', appDeploymentSchema);
