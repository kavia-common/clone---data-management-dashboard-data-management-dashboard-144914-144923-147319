'use strict';

const db = require('../config/db');
const { withTenantMatch } = require('../utils/tenantFilter');

/**
 * Aggregate LLM cost by agent for the current tenant.
 */
// PUBLIC_INTERFACE
exports.costByAgent = async (req, res) => {
  try {
    const tenantId = req?.auth?.tenantId;
    if (!tenantId) return res.status(403).json({ success: false, message: 'Tenant required' });

    const { llm_costs } = db.getCollections();
    const pipeline = [
      { $unwind: '$Agents' },
      {
        $group: {
          _id: '$Agents.Agent Name',
          total_cost: {
            $sum: {
              $toDouble: {
                $replaceAll: {
                  input: { $ifNull: ['$Agents.Total Cost', '0'] },
                  find: '$',
                  replacement: ''
                }
              }
            }
          }
        }
      },
      {
        $project: {
          agent: '$_id',
          total_cost: { $round: ['$total_cost', 6] },
          _id: 0
        }
      },
      { $sort: { total_cost: -1 } }
    ];
    const data = await llm_costs.aggregate(withTenantMatch(pipeline, tenantId)).toArray();
    res.json(data);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
