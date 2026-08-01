import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import { AuthContext, type AuthContextValue } from '../../hooks/useAuth';

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
  it('does not show Preview Canvas in navigation', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={authContextValue}>
          <Sidebar isExpanded />
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /preview canvas/i })).not.toBeInTheDocument();
  });
});
