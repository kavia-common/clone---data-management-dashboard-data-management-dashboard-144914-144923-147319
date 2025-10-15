# useProjectCost manual testing notes

- Endpoint: GET /api/projects/:projectId/cost
- Response: { projectId, cost, currency }

Manual test steps:
1) Ensure backend is running and reachable at REACT_APP_API_BASE_URL or same-origin /api proxy.
2) In the UI, open TabbedUserModal -> Projects tab for any user that has projects. The cost will render per project card.
3) For direct hook validation, temporarily mount the hook in a test component and try:
   - projectId "21566"
   - projectId "20684"

Expected behavior:
- Shows "Loading…" while fetching.
- On success, displays Intl formatted currency (e.g., $12.3400).
- On failure or missing projectId, displays "—" and a small error note on the card.
- Avoids calling the API if projectId is undefined/empty/—.
