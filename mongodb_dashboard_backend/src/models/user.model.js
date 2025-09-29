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
    referral_stats: { type: ReferralStatsSchema, default: () => ({}) },
    created_at: { type: Date, default: Date.now, index: true },
    updated_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false, collection: 'users' }
);

// Useful indexes
UserSchema.index({ created_at: -1 });
UserSchema.index({ 'referral_stats.last_referral_date': -1 });

// Keep updated_at current on update operations
UserSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

module.exports = mongoose.model('User', UserSchema);
