import axios from 'axios';
import { getApiBase } from './utilBase';

// Create or reuse a configured axios instance if the project doesn't already export one under this path.
// This wrapper relies on environment variables already configured elsewhere (no hardcoded CORS/headers).
const baseURL = getApiBase ? getApiBase() : process.env.REACT_APP_BACKEND_URL || process.env.REACT_APP_API_BASE_URL || '';

const apiClient = axios.create({
  baseURL,
  timeout: Number(process.env.REACT_APP_AXIOS_TIMEOUT_MS || process.env.REACT_APP_FETCH_TIMEOUT_MS || 15000),
});

// PUBLIC_INTERFACE
export default apiClient;

/** This is a public axios client instance used for API requests. */
