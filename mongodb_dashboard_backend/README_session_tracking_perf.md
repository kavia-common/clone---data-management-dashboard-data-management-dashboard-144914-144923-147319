# /api/session-tracking performance notes

- Strong ETag generation with If-None-Match 304 handling (hash over response signature)
- Short-lived in-memory cache (env: ENABLE_ROUTE_CACHE=true, CACHE_TTL_SECONDS=60)
- Normalized cache keys: tenant_id, page, limit/pageSize, q, start/end rounded to minute, sort
- Cache invalidation: on POST/PUT/DELETE /api/session-tracking
- Deterministic sort default: -session_start (cursor-friendly)
- Cache-Control: public, max-age=<TTL>, must-revalidate
- Compression: ENABLE_RESPONSE_COMPRESSION=true enables gzip/brotli (global middleware)

Headers
- ETag: <hash>  (when ENABLE_ETAG=true)
- Cache-Control: public, max-age=TTL, must-revalidate
- X-Cache: HIT on in-memory cache hit
- X-Filter-Ignored: true when 'filter' query param is present but server ignores it
- X-Sessions-Bypass/X-Applied-Tenant: diagnostics for tenant scoping

Env (safe defaults)
- ENABLE_ROUTE_CACHE=true
- CACHE_TTL_SECONDS=60
- ENABLE_ETAG=true
- ENABLE_RESPONSE_COMPRESSION=true

No response shape changes. Only performance and headers added.
