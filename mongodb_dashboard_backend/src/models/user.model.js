const mongoose = require('mongoose');

const ReferralStatsSchema = new mongoose.Schema(
  {
    total_referrals: { type: Number, default: 0 },
    verified_referrals: { type: Number, default: 0 },
    last_referral_date: { type: Date, default: null },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    referral_code: { type: String, required: true, index: true, unique: true },
    // Accept either object or array for referral_stats using Mixed to match heterogeneous data in cluster
    referral_stats: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false, collection: 'users' }
);

// Useful indexes
UserSchema.index({ created_at: -1 });
// If referral_stats is an array on some docs, this index will still be valid for those with object form
UserSchema.index({ 'referral_stats.last_referral_date': -1 });

// Keep updated_at current on update operations
UserSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

module.exports = mongoose.model('User', UserSchema);
