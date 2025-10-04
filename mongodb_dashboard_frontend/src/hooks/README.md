useProjectUsage hook

- Fetches project usage from backend endpoint GET /api/projects/:projectId/usage.
- Uses REACT_APP_API_BASE_URL to prefix the API calls. Ensure this environment variable is configured by the orchestrator.
- Returns { data, loading, error, refetch }.
