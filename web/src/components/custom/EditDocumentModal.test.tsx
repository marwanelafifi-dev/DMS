import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { EditDocumentModal } from './EditDocumentModal';

describe('EditDocumentModal draft recovery', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(apiClient, 'getDocument').mockResolvedValue({
      success: true,
      data: {
        documentId: 'document-1',
        folderId: 'folder-1',
        fileName: 'Procedure.docx',
        description: 'Initial description',
        versionLabel: '1',
        category: 'Procedure',
        department: 'Quality',
        ownerId: 'owner-1',
        tags: [],
      },
    });
    vi.spyOn(apiClient, 'getUsers').mockResolvedValue({ success: true, data: [{ userId: 'owner-1', fullName: 'Owner' }] });
    vi.spyOn(apiClient, 'getDropdownList').mockImplementation(async (key) => ({
      success: true,
      data: [{ label: key === 'category' ? 'Procedure' : 'Quality' }],
    }));
    vi.spyOn(apiClient, 'getMyEffectivePermissions').mockResolvedValue({
      success: true,
      data: { canChangeDocumentOwner: true },
    });
  });

  it('restores unsaved values after route-style unmount and clears them on Cancel', async () => {
    const user = userEvent.setup();
    const first = render(
      <EditDocumentModal documentId="document-1" fileName="Procedure.docx" onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    const description = await screen.findByDisplayValue('Initial description');
    await user.clear(description);
    await user.type(description, 'Unsaved description');
    first.unmount();

    const onClose = vi.fn();
    const second = render(
      <EditDocumentModal documentId="document-1" fileName="Procedure.docx" onClose={onClose} onSaved={vi.fn()} />,
    );
    expect(await screen.findByDisplayValue('Unsaved description')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    second.unmount();

    render(<EditDocumentModal documentId="document-1" fileName="Procedure.docx" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByDisplayValue('Initial description')).toBeInTheDocument();
  });
});
