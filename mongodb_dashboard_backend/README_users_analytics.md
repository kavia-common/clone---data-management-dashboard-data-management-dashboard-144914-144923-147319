# Overview Agents (Department Aggregation)

- Endpoint: GET /api/analytics/agents?grouping=department
- Filters: tenant_id, project_id, from, to, limit, offset
- Joins: llm_costs.user_id -> users.user_id; groups by users.department
- Returns: { items: [ { department, total_cost, user_count } ], total, meta }

Frontend
- Use getDepartmentAggregation() from src/api/analyticsAgents.js
- Example:
  const { items } = await getDepartmentAggregation({ tenant_id: 'org1' });

Notes
- Ensure REACT_APP_API_BASE_URL points to backend (default provided in client.js).
