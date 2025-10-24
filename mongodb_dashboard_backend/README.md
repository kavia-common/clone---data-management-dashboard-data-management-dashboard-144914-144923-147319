# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Docs (Swagger UI): http://localhost:3001/docs
- OpenAPI JSON: http://localhost:3001/openapi.json

Environment example: see .env.example.

CORS
- Defaults allow localhost:3000.
- You can set FRONTEND_ORIGIN or CORS_ORIGINS or define REACT_APP_API_BASE_URL and we infer its origin.

Key route to verify:
- GET /api/users/active-trend (e.g., http://localhost:3001/api/users/active-trend)

## Analytics: LLM cost distribution by agent

GET /api/analytics/llm-cost-by-agent

Description:
- Aggregates the LLM costs collection by agent and sums total cost per agent.
- Returns a sorted array of objects: [{ agent: string, total_cost: number }], descending by total_cost.
- Values are rounded to 6 decimal places and returned as numbers (not strings).
- If no data exists, returns an empty array [].

Sample curl:
```bash
# Basic request
curl -s http://localhost:3001/api/analytics/llm-cost-by-agent | jq .

# Example response:
# [
#   { "agent": "GenerateDescriptionAgent", "total_cost": 1.234567 },
#   { "agent": "SummarizeAgent", "total_cost": 0.447605 }
# ]
```

Response example (200):
[
  { "agent": "GenerateDescriptionAgent", "total_cost": 1.234567 },
  { "agent": "SummarizeAgent", "total_cost": 0.447605 }
]

Notes:
- The service auto-detects plausible collections (llm-costs, llm_costs, llm_cost, logs, events, interactions, agentLogs) and supports both a flat schema (agent_name|agent|tool + total_cost|cost) and an Agents[] array schema with fields "Agent Name" and "Total Cost".
- Missing/empty agent names fall back to "Unknown".
- The aggregation strips leading '$' and commas from cost values and safely parses them to numbers.
- The implementation handles malformed or missing values safely and returns [] when no data.
- See /docs for OpenAPI details.
