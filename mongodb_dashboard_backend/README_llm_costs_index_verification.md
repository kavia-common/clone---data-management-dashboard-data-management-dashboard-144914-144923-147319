# Verifying llm_costs data and indexes (underscore endpoint)

Presence/shape check for tenant `b2c`:
1) Ensure `db_connection.txt` exists at repo root or in deployment environment with contents like:
   mongosh "mongodb+srv://<user>:<pass>@<cluster>/<db>?retryWrites=true&w=majority"
2) Run these one-liners (replace <db> if your connection does not set a default DB):

Count by exact organization_id:
mongosh -f /dev/stdin <<'EOF'
const m = db.getMongo(); const dbName = db.getName(); 
print('Using DB:', dbName);
const coll = db.getCollection((process.env?.LLMCOSTS_COLLECTION_NAME || process.env?.LLM_COSTS_COLLECTION || 'llm_costs'));
print('Collection:', coll.getName());
print('Total b2c exact:', coll.countDocuments({ organization_id: 'b2c' }));
print('Total b2c regex (ci):', coll.countDocuments({ organization_id: { $regex: '^b2c$', $options: 'i' } }));
print('Sample doc:', JSON.stringify(coll.findOne({ organization_id: 'b2c' }), null, 2));
EOF

Recommended indexes for list performance:
- { tenant_id: 1, timestamp: -1 }
- { organization_id: 1, timestamp: -1 }  (optional when organization_id is used consistently)
- { timestamp: -1 }

Create index examples (idempotent):
mongosh -e "db.getCollection((process.env?.LLMCOSTS_COLLECTION_NAME || process.env?.LLM_COSTS_COLLECTION || 'llm_costs')).createIndex({ organization_id: 1, timestamp: -1 })"
mongosh -e "db.getCollection((process.env?.LLMCOSTS_COLLECTION_NAME || process.env?.LLM_COSTS_COLLECTION || 'llm_costs')).createIndex({ tenant_id: 1, timestamp: -1 })"

Notes:
- If your data uses `tenant_id` instead of `organization_id`, the underscore endpoint still works when you pass `organization_id` only if those fields exist in documents. Prefer using the hyphen endpoint `/api/llm-costs` for strict tenant enforcement through headers/JWT.
