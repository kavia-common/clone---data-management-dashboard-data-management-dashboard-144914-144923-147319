import { getApiBase } from "./config";

/**
 * Internal helper: detect absolute URLs.
 */
function isAbsoluteUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

/**
 * Internal helper: join base and path, avoiding double slashes.
 * Handles:
 * - relative paths like "/users"
 * - "/api/..." paths (joins with base root, stripping trailing "/api")
 * - absolute URLs (returned as-is)
 */
function buildUrl(pathOrUrl) {
  const base = getApiBase(); // e.g., "http://host:3001/api"
  if (isAbsoluteUrl(pathOrUrl)) return pathOrUrl;

  const baseRoot = String(base).replace(/\/+$/, "");
  const hasApiSuffix = /\/api$/.test(baseRoot);

  const path = String(pathOrUrl || "");
  if (path.startsWith("/api")) {
    // Join against base root (strip trailing "/api" from base)
    const root = hasApiSuffix ? baseRoot.replace(/\/api$/, "") : baseRoot;
    return `${root}${path}`;
  }

  // Normal: join base+"/api" with relative path
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${baseRoot}${p}`;
}

/**
 * Internal helper: build query string from params.
 */
function toQuery(params = {}) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      v.forEach((val) => usp.append(k, String(val)));
    } else if (typeof v === "object") {
      usp.append(k, JSON.stringify(v));
    } else {
      usp.append(k, String(v));
    }
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Internal helper: parse response and return { ok, status, data|text }.
 */
async function parseResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  try {
    const payload = isJson ? await res.json() : await res.text();
    return { ok: res.ok, status: res.status, payload };
  } catch {
    return { ok: res.ok, status: res.status, payload: null };
  }
}

/**
 * Axios-like "get" returning { data }.
 */
async function httpGet(pathOrUrl, { params, headers, signal } = {}) {
  const url = buildUrl(`${pathOrUrl}${toQuery(params)}`);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(headers || {}),
    },
    signal,
    credentials: "omit",
  });
  const { ok, status, payload } = await parseResponse(res);
  if (!ok) {
    const message =
      (payload && typeof payload === "object" && (payload.message || payload.detail)) ||
      (typeof payload === "string" ? payload : `Request failed (${status})`);
    const err = new Error(message);
    err.status = status;
    err.payload = payload;
    throw err;
  }
  return { data: payload };
}

async function httpJson(method, pathOrUrl, body, { headers, signal } = {}) {
  const url = buildUrl(pathOrUrl);
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(headers || {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    credentials: "omit",
  });
  const { ok, status, payload } = await parseResponse(res);
  if (!ok) {
    const message =
      (payload && typeof payload === "object" && (payload.message || payload.detail)) ||
      (typeof payload === "string" ? payload : `Request failed (${status})`);
    const err = new Error(message);
    err.status = status;
    err.payload = payload;
    throw err;
  }
  return { data: payload };
}

function normalizeListPayload(payload) {
  const items = Array.isArray(payload) ? payload : payload?.data || [];
  const total =
    (payload && payload.meta && typeof payload.meta.total === "number" && payload.meta.total) ||
    (Array.isArray(items) ? items.length : 0);
  return { items, total, meta: payload?.meta || null };
}

// PUBLIC_INTERFACE
export function getApiClient() {
  /** Returns a minimal axios-like client with get/post/put/delete that uses fetch under the hood. */
  return {
    get: (pathOrUrl, options = {}) => httpGet(pathOrUrl, options),
    post: (pathOrUrl, body, options = {}) => httpJson("POST", pathOrUrl, body, options),
    put: (pathOrUrl, body, options = {}) => httpJson("PUT", pathOrUrl, body, options),
    delete: (pathOrUrl, options = {}) => httpJson("DELETE", pathOrUrl, undefined, options),
  };
}

// PUBLIC_INTERFACE
export async function health() {
  /** Backend health: prefer absolute base root "/" on backend host, but support "/api/auth/health" fallback. */
  try {
    const base = getApiBase(); // ends with /api
    const root = String(base).replace(/\/api$/, "");
    const res = await httpGet(`${root}/`);
    return res.data;
  } catch {
    const res = await httpGet("/api/auth/health");
    return res.data;
  }
}

// PUBLIC_INTERFACE
export async function listUsers(params = {}) {
  /** Lists users with optional pagination/filter/sort, normalized to { items, total, meta }. */
  const res = await httpGet("/api/users", { params });
  return normalizeListPayload(res.data);
}

// PUBLIC_INTERFACE
export async function listSessions(params = {}) {
  /** Lists session tracking records normalized to { items, total, meta }. */
  const res = await httpGet("/api/session-tracking", { params });
  return normalizeListPayload(res.data);
}

// PUBLIC_INTERFACE
export async function listDeployments(params = {}) {
  /** Lists app deployments normalized to { items, total, meta }. */
  const res = await httpGet("/api/app-deployments", { params });
  return normalizeListPayload(res.data);
}

// PUBLIC_INTERFACE
export async function listLlmCosts(params = {}) {
  /** Lists LLM cost records normalized to { items, total, meta }. */
  const res = await httpGet("/api/llm-costs", { params });
  return normalizeListPayload(res.data);
}

export default {
  getApiClient,
  listUsers,
  listSessions,
  listDeployments,
  listLlmCosts,
  health,
};
