import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import TenantBootstrap from '../TenantBootstrap';

// Mock useNavigate to assert redirections
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: jest.fn(),
  };
});

describe('TenantBootstrap', () => {
  beforeEach(() => {
    jest.spyOn(window, 'fetch').mockReset();
    useNavigate.mockReset();
  });

  function renderAt(pathname = '/dashboard/overview') {
    useNavigate.mockReturnValue(jest.fn());
    return render(
      <MemoryRouter initialEntries={[pathname]}>
        <TenantBootstrap />
      </MemoryRouter>
    );
  }

  test('navigates to selector when multiple tenants', async () => {
    const nav = jest.fn();
    useNavigate.mockReturnValue(nav);
    window.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => [{ id: 'a' }, { id: 'b' }],
    });

    renderAt('/dashboard/overview');

    await waitFor(() => {
      expect(nav).toHaveBeenCalledWith('/tenant/select', { replace: true });
    });
  });

  test('auto-selects when exactly one tenant', async () => {
    const nav = jest.fn();
    useNavigate.mockReturnValue(nav);

    // GET tenants
    window.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => [{ id: 'only' }],
    });
    // POST select
    window.fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true }),
    });

    renderAt('/dashboard/overview');

    await waitFor(() => {
      expect(nav).toHaveBeenCalledWith('/dashboard/overview', { replace: true });
    });
  });

  test('does not run when already on /tenant/select', async () => {
    const nav = jest.fn();
    useNavigate.mockReturnValue(nav);
    renderAt('/tenant/select');
    // No fetch should be attempted
    expect(window.fetch).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });
});
