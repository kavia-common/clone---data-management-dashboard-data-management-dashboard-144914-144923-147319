# Index Recommendations for Users Analytics

To optimize analytics queries introduced under `/api/users/analytics`, ensure the following indexes exist on the `users` collection:

- Activity & trends:
  - `{ updated_at: 1 }`
  - `{ organization_id: 1, updated_at: -1 }` (optional compound)
  - `{ department: 1 }` (for breakdowns)
- Growth & cohorts:
  - `{ created_at: 1 }`
  - `{ organization_id: 1, created_at: 1 }` (optional compound)
- Compliance (if `accepted_at` used):
  - `{ accepted_at: 1 }`

These indexes will help accelerate time-bounded queries and sorting by recency.
