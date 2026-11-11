import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import { AuthContext, type AuthContextValue } from '../../hooks/useAuth';
import { apiClient } from '../../utils/api';

const authContextValue: AuthContextValue = {
  user: {
    userId: '00000000-0000-0000-0000-000000000001',
    fullName: 'Test User',
    email: 'test@si-ware.com',
    role: 'Full Access',
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  isLoading: false,
  error: null,
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
};

describe('Sidebar', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getPlatformSettings').mockResolvedValue({ success: true, data: {} } as any);
    vi.spyOn(apiClient, 'getPageAccessRoles').mockResolvedValue({ success: true, data: [{ role: 'Full Access', canViewDashboard: true, canViewDocumentLibrary: true, canViewApprovals: true, canViewPcar: true, canViewReminders: true, canSendAnnouncements: true, canViewAdminPanel: true }] } as any);
  });

  it('keeps application navigation while removing compliance and vault decoration', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={authContextValue}>
          <Sidebar isExpanded />
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /preview canvas/i })).not.toBeInTheDocument();
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Document Library')).toBeInTheDocument();
    expect(screen.getByText('PCAR (Auditor Findings)')).toBeInTheDocument();
    expect(screen.queryByText('Compliance')).not.toBeInTheDocument();
    expect(screen.queryByText('ISO 9001:2015')).not.toBeInTheDocument();
    expect(screen.queryByText('ISO 27001:2022')).not.toBeInTheDocument();
    expect(screen.queryByText('On-Premises Vault')).not.toBeInTheDocument();
    expect(screen.getByText(/Build 20260721/)).toBeInTheDocument();
  });

  it('does not disclose navigation labels while page access is still loading', async () => {
    vi.mocked(apiClient.getPageAccessRoles).mockImplementation(() => new Promise(() => {}));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={authContextValue}>
          <Sidebar isExpanded />
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(apiClient.getPageAccessRoles).toHaveBeenCalled());
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Document Library')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });
});
