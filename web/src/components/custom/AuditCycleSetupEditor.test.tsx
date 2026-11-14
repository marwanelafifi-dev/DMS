import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { AuditCycleSetupEditor } from './AuditCycleSetupEditor';

describe('AuditCycleSetupEditor', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getAuditCycleSetupOptions').mockResolvedValue({ success: true, data: [
      { folderId: 'hiring', path: 'Corporate / QMS / Procedures / Human Resources / Hiring', departmentFolderId: 'hr', departmentFolderName: 'Human Resources', controlledDocumentCount: 2, eligibleUsers: [
        { userId: 'alice', fullName: 'Alice Owner', email: 'alice@example.com' },
        { userId: 'bob', fullName: 'Bob Manager', email: 'bob@example.com' },
      ] },
      { folderId: 'training', path: 'Corporate / QMS / Procedures / Human Resources / Training', departmentFolderId: 'hr', departmentFolderName: 'Human Resources', controlledDocumentCount: 1, eligibleUsers: [
        { userId: 'bob', fullName: 'Bob Manager', email: 'bob@example.com' },
      ] },
    ] });
  });

  it('saves multiple covered folders and multiple eligible people under one department', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AuditCycleSetupEditor standard="ISO 9001:2015" saveLabel="Create cycle with setup" onSave={onSave} />);

    await user.click(await screen.findByRole('checkbox', { name: /Human Resources \/ Hiring/ }));
    await user.click(screen.getByRole('checkbox', { name: /Human Resources \/ Training/ }));
    await user.click(screen.getByRole('checkbox', { name: /Alice Owner/ }));
    await user.click(screen.getByRole('checkbox', { name: /Bob Manager/ }));
    await user.click(screen.getByRole('button', { name: 'Create cycle with setup' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      folderIds: ['hiring', 'training'],
      departments: [{ departmentFolderId: 'hr', userIds: ['alice', 'bob'] }],
    }));
  });
});
