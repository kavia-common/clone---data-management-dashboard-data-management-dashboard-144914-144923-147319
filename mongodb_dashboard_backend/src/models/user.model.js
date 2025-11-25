'use strict';

const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * User Mongoose model
 * A permissive schema to accommodate varied user documents across seeds/tenants.
 * Includes common fields referenced by routes such as referral_code, referral_stats,
 * referral_history, created_at, and updated_at. Uses strict: false to allow extra fields.
 */
const ReferralHistorySchema = new mongoose.Schema(
  {
    user_id: { type: String, index: true, sparse: true },
    user_email: { type: String, index: true, sparse: true },
    user_name: { type: String },
    referred_at: { type: Date },
    status: { type: String },
  },
  { _id: false, strict: false }
);

const UserSchema = new mongoose.Schema(
  {
    // Identifiers
    organization_id: { type: String, index: true, sparse: true },
    email: { type: String, index: true, sparse: true },
    username: { type: String, index: true, sparse: true },
    user_id: { type: String, index: true, sparse: true },

    // Names
    name: { type: String },
    displayName: { type: String },
    display_name: { type: String },
    full_name: { type: String },
    fullName: { type: String },
    user_name: { type: String },

    // Status/Meta
    department: { type: String, index: true, sparse: true },
    status: { type: String, index: true, sparse: true },
    has_accepted_terms: { type: Boolean, index: true, sparse: true },

    // Referrals
    referral_code: { type: String, index: true, sparse: true },
    referral_stats: { type: mongoose.Schema.Types.Mixed, default: {} },
    referral_history: { type: [ReferralHistorySchema], default: [] },

    // Profile (flexible)
    profile: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Timestamps
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now, index: true },
  },
  {
    collection: 'users',
    strict: false, // allow unknown fields for backwards compatibility
    minimize: false,
  }
);

// Maintain updated_at automatically on save/update via direct model operations
UserSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});
UserSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

// Helpful compound indexes for common lookups (sparse to avoid duplicates on missing)
UserSchema.index({ organization_id: 1, email: 1 }, { unique: false, sparse: true });

// PUBLIC_INTERFACE
/**
 * ensureUserIndexes
 * Ensure key indexes are created (safe to call on startup or ad-hoc).
 */
async function ensureUserIndexes() {
  try {
    await User.init(); // creates declared indexes
  } catch (err) {
    // avoid crashing on index creation errors in heterogeneous data environments
     
    console.warn('ensureUserIndexes warning:', err?.message || err);
  }
}

const User = mongoose.models.User || mongoose.model('User', UserSchema);

module.exports = User;
module.exports.ensureUserIndexes = ensureUserIndexes;
