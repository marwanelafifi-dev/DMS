import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { UserManagement } from './UserManagement';

const sourceUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  fullName: 'System Administrator',
  email: 'admin@example.com',
  isActive: true,
  createdAt: '2026-08-28T00:00:00Z',
  authType: 'Local' as const,
  isOnline: false,
  role: 'FullAccess',
};

const otherPageUser = {
  ...sourceUser,
  userId: '22222222-2222-4222-8222-222222222222',
  fullName: 'Another Full Access User',
  email: 'full-access@example.com',
};

describe('UserManagement ownership transfer targets', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getUsers').mockImplementation(async (params?: { page?: number }) => ({
      success: true,
      data: params?.page ? [sourceUser] : [sourceUser, otherPageUser],
      totalCount: params?.page ? 20 : 2,
      totalPages: params?.page ? 2 : 1,
    }));
    vi.spyOn(apiClient, 'getPageAccessRoles').mockResolvedValue({ success: true, data: [] });
    vi.spyOn(apiClient, 'getGroups').mockResolvedValue({ success: true, data: [] });
  });

  it('offers active users loaded outside the current page as transfer recipients', async () => {
    const user = userEvent.setup();
    render(<UserManagement />);

    await screen.findByText(sourceUser.fullName);
    await user.click(screen.getByTitle('Delete user permanently'));

    const transferSelect = screen.getByRole('combobox', {
      name: /transfer their owned folders\/documents\/tasks/i,
    });
    expect(within(transferSelect).getByRole('option', { name: otherPageUser.fullName })).toBeInTheDocument();
    expect(within(transferSelect).queryByRole('option', { name: sourceUser.fullName })).not.toBeInTheDocument();
  });
});
