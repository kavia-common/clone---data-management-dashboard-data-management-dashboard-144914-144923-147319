Costs Details Modal - Frontend Notes

Purpose:
- Display curated costs details instead of raw JSON:
  * Users table: User, Type, User Cost
  * Nested Projects list per user: Project, Project Cost
  * LLM costs section: total and breakdown table (Model, User, Project, Cost)

API endpoints used (frontend only, no backend changes made):
- GET /api/users?limit=200
  - Used to list users and basic fields like name/email, type.
  - We also attempt to read user_cost if present on the user payload.
- GET /api/users/{userId}/costs (optional)
  - If available, used to get a definitive total_cost (alias user_cost).
- GET /api/users/{userId}/projects/costs (optional)
  - If available, used to retrieve per-project project_cost for the user.
  - If not available, we fallback to any projects array inside the user document.
- GET /api/llm-costs?limit=200
  - Used to display a total and a table showing model/user/project and cost.

Implementation details:
- The modal fetches data when opened (isOpen=true).
- Loading and error states are shown with Ocean Professional theme styles.
- If some fields are missing, the UI shows '—' to avoid raw object dumps.
- Styling aligns to primary #2563EB, secondary #F59E0B, surface #ffffff, text #111827.

If your backend uses different endpoints or payload shapes:
- Update the fetch URLs or mapping logic in CostsDetailsModal.jsx accordingly (look for TODO comments).
