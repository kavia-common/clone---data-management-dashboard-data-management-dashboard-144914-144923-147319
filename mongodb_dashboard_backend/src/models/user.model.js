const mongoose = require('mongoose');

/**
 * The dataset indicates that users collection can have:
 * - referral_code: string (may be missing or duplicated in the wild)
 * - referral_stats: object OR array<object> (heterogeneous across documents)
 * - referral_history: array<object> with multiple shapes and types
 *
 * To avoid runtime exceptions and 500s when listing/fetching, we keep the schema
 * permissive and align with all observed variants.
 */

// Subdocument for referral_history with flexible types
const ReferralHistoryItemSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.Mixed }, // string | ObjectId
    user_email: { type: String }, // may not always be a valid email
    user_name: { type: String },
    referred_at: { type: Date }, // DB strings will be cast to Date when valid
    verified_at: { type: Date, default: null },
    status: { type: String }, // e.g., pending, verified, other (do not enforce enum to avoid rejects)
  },
  { _id: false }
);

// Note: ReferralStats can be array<object> or a single object. Keep Mixed to avoid cast issues.
// Keeping a typed schema for reference but not using it directly to avoid conflicts.
/* const ReferralStatsSchema = new mongoose.Schema(
  {
    total_referrals: { type: Number, default: 0 },
    verified_referrals: { type: Number, default: 0 },
    last_referral_date: { type: Date, default: null },
  },
  { _id: false }
); */

const UserSchema = new mongoose.Schema(
  {
    // Core auth fields (optional, added for auth flows)
    email: { type: String, index: true, sparse: true },
    // password_hash stores algorithm-encoded string (argon2/bcrypt/scrypt).
    // We intentionally keep it selectable to simplify this backend; do not expose in API responses.
    password_hash: { type: String, default: null },
    // hashVersion: 1 (legacy static salt), 2 (tenant orgSalt + pepper)
    // Default to 2 for new accounts; legacy documents may have null/1 and will be migrated on login.
    hashVersion: { type: Number, default: 2 },

    // Not required and not unique in production datasets; keep a sparse index only on present docs
    referral_code: { type: String, index: true, sparse: true },
    // Accept either object or array for referral_stats using Mixed to match heterogeneous data in cluster
    referral_stats: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    // Accept flexible, optional referral history items
    referral_history: { type: [ReferralHistoryItemSchema], default: [] },
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: false,
    collection: 'users',
    // Strict false to accept additional fields that may exist in real documents
    // without causing rejects during reads/writes (e.g., future fields).
    strict: false,
  }
);

// Suggested and useful indexes compatible with heterogeneous data
UserSchema.index({ created_at: -1 });
UserSchema.index({ referral_code: 1 });
// If referral_stats is an array on some docs, this index will still be valid for those with object form
UserSchema.index({ 'referral_stats.last_referral_date': -1 });
// Indexes aligned with schema guidance for referral_history
UserSchema.index({ 'referral_history.user_id': 1 });
UserSchema.index({ 'referral_history.status': 1, 'referral_history.referred_at': -1 });

// Optional convenience index for email-based auth lookups
UserSchema.index({ email: 1 }, { sparse: true });

// Keep updated_at current on update operations
UserSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

module.exports = mongoose.model('User', UserSchema);
