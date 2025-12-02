# useUsersData

Purpose:
- Centralized, memoized users list fetching hook to avoid duplicate API calls.
- Batches all criteria (filter, pagination, sort, search) into a single request.
- Caches responses per query key.
- Dedupes concurrent identical requests and cancels in-flight requests when parameters change.
- Exposes loading, error and refetch.

Usage:
- Import `useUsersData` and call with `{ page, limit, sort, filter, search }`.
- Prefer using data fields from the list response to avoid per-record fetches. If detail info is required, parallelize such fetches with `Promise.all` and add client-side memoization.

Notes:
- The base API client already enforces tenant scoping and sanitizes unsupported params for `/api/users`.
- Cache TTL (default 30s) can be tuned via `cacheTimeMs`.
