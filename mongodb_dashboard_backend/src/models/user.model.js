'use strict';

const mongoose = require('mongoose');
const { Schema, model } = mongoose;

/**
 * PUBLIC_INTERFACE
 * Minimal User model
 * - Includes fields referenced across routes and auth utilities.
 * - Collection name: 'users'
 */
const userSchema = new Schema(
  {
    email: { type: String, index: true },
    password_hash: { type: String, default: null },
    hashVersion: { type: Number, default: null },
    tenant_id: { type: String, index: true },
    referral_code: { type: String },
    referral_stats: Schema.Types.Mixed,
    referral_history: [Schema.Types.Mixed],
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'users' }
);

module.exports = model('User', userSchema);
