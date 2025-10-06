 /**
  * PUBLIC_INTERFACE
  * getApiBaseUrl
  * Resolves the backend API base URL.
  * - If REACT_APP_API_BASE_URL is provided, it normalizes and ensures a single '/api' suffix.
  * - If not provided, defaults to '/api' to work with CRA development proxy.
  *
  * Notes:
  * - Do NOT include '/api' in REACT_APP_API_BASE_URL; this helper will append it if missing.
  * - Examples:
  *    REACT_APP_API_BASE_URL=http://localhost:3001  -> http://localhost:3001/api
  *    REACT_APP_API_BASE_URL=https://example.com    -> https://example.com/api
  *    (unset)                                       -> /api  (uses CRA proxy in development)
  */
 export function getApiBaseUrl() {
   const raw = process.env.REACT_APP_API_BASE_URL || '';
   const trimmed = String(raw).trim();

   // If no env provided, rely on CRA proxy with same-origin '/api'
   if (!trimmed) {
     if (process.env.NODE_ENV !== 'production') {
       // eslint-disable-next-line no-console
       console.info('[API] Using CRA proxy at /api (no REACT_APP_API_BASE_URL set)');
     }
     return '/api';
   }

   // Normalize: remove trailing slashes
   let base = trimmed.replace(/\/*$/, '');

   // Avoid double '/api' if user already included it
   if (!base.endsWith('/api')) {
     base = `${base}/api`;
   }

   if (process.env.NODE_ENV !== 'production') {
     // eslint-disable-next-line no-console
     console.info('[API] Using explicit API base URL:', base);
   }
   return base;
 }
