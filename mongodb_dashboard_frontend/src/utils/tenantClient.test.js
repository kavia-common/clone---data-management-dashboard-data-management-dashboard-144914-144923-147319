/* eslint-disable no-undef */
import { fetchSessionTenants, selectTenant, getActiveTenant, setActiveTenant, normalizeTenantId } from './tenantClient';

describe('tenantClient utilities', () => {
  beforeEach(() => {
    jest.spyOn(window, 'fetch').mockReset();
    window.localStorage.clear();
  });

  test('normalizeTenantId handles various shapes', () => {
    expect(normalizeTenantId({ tenant_id: 'a' })).toBe('a');
    expect(normalizeTenantId({ tenantId: 'b' })).toBe('b');
    expect(normalizeTenantId({ id: 123 })).toBe('123');
    expect(normalizeTenantId({ _id: 'z' })).toBe('z');
    expect(normalizeTenantId('x')).toBe('x');
    expect(normalizeTenantId(null)).toBeNull();
  });

  test('fetchSessionTenants returns array when server returns items', async () => {
    window.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ items: [{ id: 't1' }] }),
    });
    const tenants = await fetchSessionTenants();
    expect(Array.isArray(tenants)).toBe(true);
    expect(tenants[0].id).toBe('t1');
    expect(window.fetch).toHaveBeenCalledWith('/api/session/tenants', expect.objectContaining({ credentials: 'include', method: 'GET' }));
  });

  test('selectTenant posts and mirrors localStorage', async () => {
    window.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true }),
    });
    await selectTenant('t-123', 'jest');
    expect(getActiveTenant()).toBe('t-123');
    // ensure fetch called with include
    expect(window.fetch).toHaveBeenCalledWith('/api/tenants/select', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
  });

  test('setActiveTenant writes preferred key and removes legacy', () => {
    window.localStorage.setItem('activeTenantId', 'old');
    setActiveTenant('new');
    expect(window.localStorage.getItem('activeTenant')).toBe('new');
    expect(window.localStorage.getItem('activeTenantId')).toBe(null);
  });

  test('selectTenant throws on validation error', async () => {
    await expect(selectTenant()).rejects.toThrow(/required/);
  });
});
