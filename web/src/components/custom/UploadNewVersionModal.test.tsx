import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { doclingApi } from '../../services/doclingApi';
import { UploadNewVersionModal } from './UploadNewVersionModal';

const documentId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';

describe('UploadNewVersionModal workflow choice', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getDocument').mockResolvedValue({
      success: true,
      data: {
        documentId,
        folderId: 'folder-1',
        currentVersionId: 'old-version',
        status: 'released',
        description: 'Customer Support Procedure',
        category: 'Process',
        department: 'Customer Support',
        ownerId,
        tags: ['ISO 9001'],
        versions: [{ versionId: 'old-version', versionNumber: '1.0', versionLabel: 'Rev A' }],
      },
    });
    vi.spyOn(apiClient, 'getDropdownList').mockImplementation(async (type) => ({
      success: true,
      data: type === 'category'
        ? [{ label: 'Process' }]
        : type === 'department'
          ? [{ label: 'Customer Support' }]
          : [{ label: 'ISO 9001' }],
    }));
    vi.spyOn(apiClient, 'getUsers').mockResolvedValue({
      success: true,
      data: [{ userId: ownerId, fullName: 'Belal Magdy', isActive: true }],
    });
    vi.spyOn(apiClient, 'getMyEffectivePermissions').mockResolvedValue({
      success: true,
      data: { canChangeDocumentOwner: true, submitForApproval: true },
    });
    vi.spyOn(apiClient, 'uploadDocument').mockResolvedValue({
      success: true,
      data: { versionId: 'new-version' },
    });
    vi.spyOn(doclingApi, 'convertDocument').mockResolvedValue({
      filename: 'Customer Support Procedure.docx',
      content: 'DOC.NO: SWS-25120002',
    });
    vi.spyOn(apiClient, 'extractDocId').mockResolvedValue({
      success: true,
      data: { found: true, originalDocumentId: 'SWS-25120002', alreadySet: true },
    });
    vi.spyOn(apiClient, 'updateDocument').mockResolvedValue({ success: true, data: {} });
    vi.spyOn(apiClient, 'submitDocumentsForApproval').mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderModal = () => {
    const onClose = vi.fn();
    const onUploaded = vi.fn();
    const file = new File(['revision'], 'Customer Support Procedure.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    render(
      <UploadNewVersionModal
        documentId={documentId}
        file={file}
        onClose={onClose}
        onUploaded={onUploaded}
      />,
    );
    return { file, onClose, onUploaded };
  };

  it('saves the new released-document revision as Draft without starting approval', async () => {
    const user = userEvent.setup();
    const { file, onClose, onUploaded } = renderModal();

    await user.type(await screen.findByPlaceholderText('e.g. v2.0, Rev B'), 'Rev B');
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));

    await waitFor(() => expect(apiClient.uploadDocument).toHaveBeenCalledWith(documentId, file, 'Rev B', ownerId));
    expect(doclingApi.convertDocument).toHaveBeenCalledWith(file);
    expect(apiClient.extractDocId).toHaveBeenCalledWith(documentId, 'DOC.NO: SWS-25120002');
    expect(apiClient.submitDocumentsForApproval).not.toHaveBeenCalled();
    expect(onUploaded).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('submits only the newly uploaded revision into the normal approval workflow', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.type(await screen.findByPlaceholderText('e.g. v2.0, Rev B'), 'Rev B');
    await user.type(screen.getByPlaceholderText('Optional notes for QA reviewers...'), 'Review the updated support process.');
    const submitButton = screen.getByRole('button', { name: 'Submit for Approval' });
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    await waitFor(() => expect(apiClient.submitDocumentsForApproval).toHaveBeenCalledWith(
      [documentId],
      'Process',
      'Review the updated support process.',
    ));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
