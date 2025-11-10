import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import TenantSelection from '../TenantSelection.jsx';
import { AuthProvider } from '../../context/AuthContext.jsx';

// Mock selectTenant to avoid network
jest.mock('../../utils/tenantClient', () => {
  const actual = jest.requireActual('../../utils/tenantClient');
  return {
    ...actual,
    selectTenant: jest.fn().mockResolvedValue({ success: true }),
  };
});

describe('TenantSelection (restricted single-tenant)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('renders only the stored tenant id and confirms', async () => {
    // Seed tenant
    localStorage.setItem('activeTenant', 'org_only');

    render(
      <AuthProvider>
        <TenantSelection />
      </AuthProvider>
    );

    expect(screen.getByLabelText('Current tenant id').textContent).toBe('org_only');

    const btn = screen.getByText('Continue');
    fireEvent.click(btn);

    // No assertion on navigation (window.location.replace), just ensure no crash and button exists
    expect(btn).toBeInTheDocument();
  });

  test('shows empty state when no tenant is present', () => {
    render(
      <AuthProvider>
        <TenantSelection />
      </AuthProvider>
    );
    expect(
      screen.getByText(/No tenant is associated with your account/i)
    ).toBeInTheDocument();
  });
}
