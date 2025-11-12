const mongoose = require('mongoose');

/**
 * Sample model for demonstrating data fetching from MongoDB.
 * This schema is intentionally permissive (strict: false) so any documents
 * in the 'sample' collection can be returned without casting issues.
 */
const SampleSchema = new mongoose.Schema(
  {
    // Optional common fields for convenience; not required
    name: { type: String },
    value: { type: mongoose.Schema.Types.Mixed },
    created_at: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: false,
    collection: 'sample',
    strict: false, // allow any shape so the endpoint works with existing data
  }
);

// Useful index for common list order
SampleSchema.index({ created_at: -1 });

module.exports = mongoose.model('Sample', SampleSchema);
