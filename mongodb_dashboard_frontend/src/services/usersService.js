import { listUsers } from './usersApi';

/**
 * PUBLIC_INTERFACE
 * getUsers
 * Proxy to existing users API listing with support for pagination, sort and filter params.
 * Accepts an object with keys: page, limit, sort, filter, search.
 */
export async function getUsers(params = {}) {
  return listUsers(params);
}
