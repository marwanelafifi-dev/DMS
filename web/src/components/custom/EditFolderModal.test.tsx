import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { EditFolderModal } from './EditFolderModal';

const folderId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';

describe('EditFolderModal manager selection', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getUsers').mockResolvedValue({
      success: true,
      data: [
        { userId: ownerId, fullName: 'Belal Magdy', role: 'User', isActive: true },
        { userId: '33333333-3333-4333-8333-333333333333', fullName: 'Manager User', role: 'Manager', isActive: true },
      ],
    });
    vi.spyOn(apiClient, 'getDropdownList').mockResolvedValue({ success: true, data: [] });
    vi.spyOn(apiClient, 'getFolder').mockResolvedValue({
      success: true,
      data: { folderId, managerIds: [] },
    });
    vi.spyOn(apiClient, 'getMyEffectivePermissions').mockResolvedValue({
      success: true,
      data: { canChangeFolderOwner: true },
    });
    vi.spyOn(apiClient, 'updateFolderMetadata').mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows the folder owner to be explicitly selected and saved as a manager', async () => {
    const user = userEvent.setup();
    render(
      <EditFolderModal
        folderId={folderId}
        folderName="Customer Support"
        initialOwnerId={ownerId}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const search = await screen.findByPlaceholderText('Search managers…');
    await user.type(search, 'belal');
    await user.click(screen.getByRole('checkbox', { name: 'Belal Magdy' }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(apiClient.updateFolderMetadata).toHaveBeenCalledWith(folderId, expect.objectContaining({
      ownerId,
      managerIds: [ownerId],
    })));
  });
});
