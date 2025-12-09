# CHANGELOG - Overview Endpoint Cleanup

- Disabled any root-level GET / route by adding an explicit 404 handler in src/routes/index.js to prevent clients from calling the backend root with organization_id.
- Confirmed /api/dashboard/overview/metrics remains removed and returns 404 by design.
- Updated README_overview_endpoint.md with notes about the root path being disabled.
- Frontend: Updated src/api/overviewAnalytics.js to gracefully handle the removed metrics endpoint with a no-op fallback to prevent runtime errors in the Overview module.

Impact:
- Overview page will no longer attempt to use backend root. It now displays fallback totals when the deprecated endpoint is not available.
- Consumers should migrate to supported analytics endpoints documented in /api-docs.
