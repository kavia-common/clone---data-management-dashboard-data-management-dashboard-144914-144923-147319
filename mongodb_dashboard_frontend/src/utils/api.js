import axios from 'axios';

/**
 * PUBLIC_INTERFACE
 * api
 * Axios instance preconfigured for the frontend to hit the Express backend.
 * Proxy is handled by setupProxy.js in development.
 */
const api = axios.create({
  // baseURL intentionally left undefined to let setupProxy handle /api in dev
  // In production, ensure the app is served from the same origin or set REACT_APP_API_BASE.
  baseURL: process.env.REACT_APP_API_BASE || undefined,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
