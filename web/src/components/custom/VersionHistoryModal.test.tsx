import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionHistoryModal } from './VersionHistoryModal';

const apiMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  deleteDocumentVersion: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../../utils/api', () => ({ apiClient: apiMocks }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => toastMocks }));
vi.mock('../../hooks/usePageAccess', () => ({
  usePageAccess: () => ({ canDeleteDocumentVersions: true }),
}));

const versions = [
  {
    versionId: 'current-version',
    versionNumber: '8.0',
    fileName: 'controlled.docx',
    fileSizeBytes: 1024,
    createdAt: '2026-08-28T10:00:00Z',
  },
  {
    versionId: 'old-version',
    versionNumber: '7.0',
    fileName: 'controlled.docx',
    fileSizeBytes: 1024,
    createdAt: '2026-08-28T09:00:00Z',
  },
];

describe('VersionHistoryModal old-version deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getDocument.mockResolvedValue({ success: true, data: { versions } });
    apiMocks.deleteDocumentVersion.mockResolvedValue({ success: true });
  });

  it('offers deletion only for historical versions and requires DELETE confirmation', async () => {
    const user = userEvent.setup();
    render(
      <VersionHistoryModal
        documentId="document-id"
        fileName="controlled.docx"
        currentVersionId="current-version"
        onClose={vi.fn()}
        onReverted={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText('Delete version 7.0')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete version 8.0')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Delete version 7.0'));
    const deleteButton = screen.getByRole('button', { name: 'Delete Version' });
    expect(deleteButton).toBeDisabled();

    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), 'DELETE');
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);

    await waitFor(() => {
      expect(apiMocks.deleteDocumentVersion).toHaveBeenCalledWith('document-id', 'old-version');
    });
    expect(toastMocks.showSuccess).toHaveBeenCalledWith('Version 7.0 deleted');
  });
});
