# useProjectCostHistorySum manual testing notes

- Preferred endpoint: GET /api/projects/:projectId/cost-history-sum
  - Returns: { projectId, cost }
- Fallback endpoint: GET /api/projects/:projectId/cost
  - Returns: { projectId, cost, currency }

Testing:
1) Ensure backend is running and reachable via REACT_APP_API_BASE_URL or same-origin /api proxy.
2) In a temporary component or console, try:
   - useProjectCostHistorySum('21566')
   - useProjectCostHistorySum('20684')

Expected:
- While loading: "Loading…"
- On success: formatted USD with 4-6 fraction digits (e.g., $0.0123)
- On failure: compact "Error" label with title tooltip, cost shows "—"
- Skips fetching when projectId is invalid (empty/undefined/—)

Notes:
- This prefers sum of cost_history.delta_total_cost because it provides precise incremental aggregation across session updates and supersedes summing total_cost per session.
