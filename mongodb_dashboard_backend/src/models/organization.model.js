'use strict';

const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * Organization Mongoose model
 *
 * Maps to the existing `organizations` collection where `_id` IS the tenant_id
 * (matches `tenant_id` used across `session_tracking`/`users`). Schema is permissive
 * (strict:false) since real documents carry many additional configuration fields
 * (plan_id, settings, configurations, group_ids, etc.) that are not relevant here.
 *
 * Fields used by the Organization feature:
 *  - _id:     String (tenant_id), e.g. "T0038"
 *  - name:    String display name, e.g. "TATA ELXSI LIMITED"
 *  - domain:  String email domain, e.g. "tataelxsi.co.in"
 *  - credits: Number (org-level allocated/budget credits; NOT the same as the
 *             per-user usage credits computed for the Organization table)
 *  - status:  String, e.g. "active" | "inactive" | "deleted"
 */
const OrganizationSchema = new mongoose.Schema(
  {
    _id: { type: String },
    name: { type: String, index: true },
    domain: { type: String, index: true },
    credits: { type: Number },
    status: { type: String, index: true },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  {
    collection: 'organizations',
    strict: false,
    minimize: false,
    timestamps: false,
    versionKey: false,
  }
);

const Organization =
  mongoose.models.Organization || mongoose.model('Organization', OrganizationSchema);

module.exports = Organization;
