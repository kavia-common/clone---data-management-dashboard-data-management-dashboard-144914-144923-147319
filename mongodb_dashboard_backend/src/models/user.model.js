const mongoose = require('mongoose');

const ReferralStatsSchema = new mongoose.Schema(
  {
    total_referrals: { type: Number, default: 0 },
    verified_referrals: { type: Number, default: 0 },
    last_referral_date: { type: Date },
  },
  { _id: false }
);

const ReferralHistoryItemSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.Mixed, required: true }, // string or ObjectId
    user_email: { type: String, required: true },
    user_name: { type: String, required: true },
    referred_at: { type: Date, required: true },
    verified_at: { type: Date, default: null },
    status: { type: String, enum: ['pending', 'verified', 'other'], required: true },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    referral_code: { type: String, index: true },
    referral_stats: { type: ReferralStatsSchema },
    referral_history: { type: [ReferralHistoryItemSchema], default: [] },
    // Optional auth fields for basic local auth in this dashboard backend
    email: { type: String, unique: true, sparse: true },
    password_hash: { type: String },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false, collection: 'users' }
);

UserSchema.index({ 'referral_history.user_id': 1 });
UserSchema.index({ 'referral_history.status': 1, 'referral_history.referred_at': -1 });

module.exports = mongoose.model('User', UserSchema);
