# useProjectCostHistorySum integration notes

- The hook imports getProjectCostHistorySum and getProjectCost from src/api/projects.js.
- src/api/projects.js now exports:
  - getProjectLlmCost(projectId)
  - getProjectCost(projectId) -> GET /api/projects/:projectId/cost
  - getProjectCostHistorySum(projectId) -> GET /api/projects/:projectId/cost-history-sum
  - default export object with the above functions
- API base URL is built using REACT_APP_API_BASE_URL (see src/api/util.js) and appends '/api'. If the variable is unset, requests default to same-origin '/api'.

To use:
import { useProjectCostHistorySum } from './useProjectCostHistorySum';
const { cost, formattedCost, loading, error } = useProjectCostHistorySum(projectId);

