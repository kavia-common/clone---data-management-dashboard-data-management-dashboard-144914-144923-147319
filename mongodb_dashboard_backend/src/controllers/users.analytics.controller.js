/**
 * PUBLIC_INTERFACE
 * Minimal users analytics controller placeholder.
 */
module.exports = {
  // For referral sources in users.routes.js, provide a no-op that returns empty.
  // Replace with real implementation as needed with tenant enforcement.
  getReferralSources: async (req, res) => {
    return res.status(200).json({ items: [], totalSources: 0 });
  },
};
