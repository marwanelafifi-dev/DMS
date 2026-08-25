import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { LegacyMetadataHistoryAction } from './LegacyMetadataHistoryAction';

const documentId = '4f4cdd06-0ce3-556a-8232-b199898d1941';
const fileName = 'Third_MDR.docx';

const completeHistory = {
  hasLegacyMetadataHistory: true,
  legacyDocumentId: 230,
  sourceSystem: 'KnowledgeTree',
  snapshots: [
    {
      metadataVersionId: 1591,
      metadataVersion: 8,
      snapshotDate: '2015-08-15T10:42:00Z',
      legacyContentVersionId: 349,
      associatedFile: {
        legacyContentVersionId: 349,
        originalFileName: 'SRD.doc',
        majorVersion: 0,
        minorVersion: 2,
        versionLabel: '0.2',
        fileDate: '2014-11-28T10:15:00Z',
        fileSizeBytes: 357376,
        fileStatus: 'Available in Legacy Archive',
        isAvailable: true,
        viewUrl: `/api/documents/${documentId}/legacy-content/349/view`,
        downloadUrl: `/api/documents/${documentId}/legacy-content/349/download`,
      },
      isCurrentAtMigration: true,
      sourceSystem: 'KnowledgeTree',
      fields: [
        { name: 'Authors', value: 'Mostafa Medhat' },
        { name: 'Description', value: 'Third MOEMS Design Review' },
        { name: 'Internal/External', value: 'Internal' },
        { name: 'IP number', value: 'ABC123' },
        { name: 'Removed Quality Gate', value: 'Legacy-only value' },
      ],
    },
    {
      metadataVersionId: 1589,
      metadataVersion: 7,
      snapshotDate: '2014-12-02T14:20:00Z',
      legacyContentVersionId: 349,
      associatedFile: {
        legacyContentVersionId: 349,
        originalFileName: 'SRD.doc',
        majorVersion: 0,
        minorVersion: 2,
        versionLabel: '0.2',
        fileDate: '2014-11-28T10:15:00Z',
        fileSizeBytes: 357376,
        fileStatus: 'Available in Legacy Archive',
        isAvailable: true,
        viewUrl: `/api/documents/${documentId}/legacy-content/349/view`,
        downloadUrl: `/api/documents/${documentId}/legacy-content/349/download`,
      },
      isCurrentAtMigration: false,
      sourceSystem: 'KnowledgeTree',
      fields: [
        { name: 'Authors', value: 'Bassem Mortada, Mostafa Medhat' },
        { name: 'Description', value: 'System Requirements Document' },
        { name: 'IP number', value: '' },
      ],
    },
  ],
};

describe('LegacyMetadataHistoryAction', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getLegacyMetadataHistory').mockResolvedValue({
      success: true,
      data: completeHistory,
    });
  });

  it('opens a distinct read-only view containing every archived field and snapshot', async () => {
    const user = userEvent.setup();
    render(
      <LegacyMetadataHistoryAction
        documentId={documentId}
        fileName={fileName}
        canView
      />,
    );

    const action = await screen.findByRole('button', {
      name: `View legacy metadata history of ${fileName}`,
    });
    await user.click(action);

    const dialog = screen.getByRole('dialog', { name: 'Legacy Metadata History' });
    expect(within(dialog).getByText('Imported from KnowledgeTree')).toBeInTheDocument();
    expect(within(dialog).getByText('Legacy document #230')).toBeInTheDocument();
    expect(within(dialog).getByText('CURRENT AT MIGRATION')).toBeInTheDocument();
    expect(within(dialog).getByText('HISTORICAL')).toBeInTheDocument();
    expect(within(dialog).getByText('Removed Quality Gate')).toBeInTheDocument();
    expect(within(dialog).getByText('Legacy-only value')).toBeInTheDocument();
    expect(within(dialog).getByText('Internal/External')).toBeInTheDocument();
    expect(within(dialog).getByText('ABC123')).toBeInTheDocument();
    expect(within(dialog).getByText('Bassem Mortada, Mostafa Medhat')).toBeInTheDocument();
    expect(within(dialog).getAllByText('SRD.doc')).toHaveLength(2);
    expect(within(dialog).getAllByText(/File Version: 0\.2/)).toHaveLength(2);
    expect(within(dialog).getAllByText('Available in Legacy Archive')).toHaveLength(2);
    expect(within(dialog).getAllByRole('button', { name: 'View SRD.doc' })).toHaveLength(2);
    expect(within(dialog).getAllByRole('button', { name: 'Download SRD.doc' })).toHaveLength(2);
    expect(within(dialog).getByText('—')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /edit|delete|restore|make current/i })).not.toBeInTheDocument();

    const newest = within(dialog).getByTestId('legacy-metadata-snapshot-8');
    const older = within(dialog).getByTestId('legacy-metadata-snapshot-7');
    expect(newest.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const headerClose = within(dialog).getByRole('button', { name: 'Close legacy metadata history' });
    await waitFor(() => expect(headerClose).toHaveFocus());
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(headerClose).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Legacy Metadata History' })).not.toBeInTheDocument();
    expect(action).toHaveFocus();
  });

  it('keeps the snapshot visible and disables file actions when its exact content export is absent', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getLegacyMetadataHistory).mockResolvedValue({
      success: true,
      data: {
        ...completeHistory,
        snapshots: [{
          ...completeHistory.snapshots[1],
          legacyContentVersionId: 245,
          associatedFile: {
            legacyContentVersionId: 245,
            originalFileName: 'siware_internal_document_template_d3.docm',
            majorVersion: 0,
            minorVersion: 1,
            versionLabel: '0.1',
            fileDate: null,
            fileSizeBytes: 239558,
            fileStatus: 'Not available in legacy export',
            isAvailable: false,
            viewUrl: null,
            downloadUrl: null,
          },
        }],
      },
    });

    render(<LegacyMetadataHistoryAction documentId={documentId} fileName={fileName} canView />);
    await user.click(await screen.findByRole('button', { name: `View legacy metadata history of ${fileName}` }));

    const dialog = screen.getByRole('dialog', { name: 'Legacy Metadata History' });
    expect(within(dialog).getByText('Not available in legacy export')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'View siware_internal_document_template_d3.docm' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Download siware_internal_document_template_d3.docm' })).toBeDisabled();
    expect(within(dialog).getByText('Bassem Mortada, Mostafa Medhat')).toBeInTheDocument();
  });

  it('opens View in the read-only preview without triggering Download', async () => {
    const user = userEvent.setup();
    const pdfHistory = {
      ...completeHistory,
      snapshots: [{
        ...completeHistory.snapshots[0],
        associatedFile: {
          ...completeHistory.snapshots[0].associatedFile,
          originalFileName: 'legacy-review.pdf',
        },
      }],
    };
    vi.mocked(apiClient.getLegacyMetadataHistory).mockResolvedValue({ success: true, data: pdfHistory });
    const fileFetch = vi.spyOn(apiClient, 'getLegacyContentFile').mockResolvedValue({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      fileName: 'legacy-review.pdf',
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<LegacyMetadataHistoryAction documentId={documentId} fileName={fileName} canView />);
    await user.click(await screen.findByRole('button', { name: `View legacy metadata history of ${fileName}` }));
    await user.click(screen.getByRole('button', { name: 'View legacy-review.pdf' }));

    const previewDialog = await screen.findByRole('dialog', { name: 'Preview legacy-review.pdf' });
    expect(previewDialog.querySelector('iframe[title="legacy-review.pdf"]')).toBeInTheDocument();
    expect(fileFetch).toHaveBeenCalledWith(documentId, 349, 'view');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('keeps Download as a separate attachment action', async () => {
    const user = userEvent.setup();
    const fileFetch = vi.spyOn(apiClient, 'getLegacyContentFile').mockResolvedValue({
      blob: new Blob(['original']),
      fileName: 'SRD.doc',
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<LegacyMetadataHistoryAction documentId={documentId} fileName={fileName} canView />);
    await user.click(await screen.findByRole('button', { name: `View legacy metadata history of ${fileName}` }));
    await user.click(screen.getAllByRole('button', { name: 'Download SRD.doc' })[0]);

    expect(fileFetch).toHaveBeenCalledWith(documentId, 349, 'download');
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Preview SRD.doc' })).not.toBeInTheDocument();
  });

  it('hides the optional action when the document has no legacy archive', async () => {
    vi.mocked(apiClient.getLegacyMetadataHistory).mockResolvedValue({
      success: true,
      data: {
        hasLegacyMetadataHistory: false,
        legacyDocumentId: null,
        sourceSystem: null,
        snapshots: [],
      },
    });

    render(
      <LegacyMetadataHistoryAction
        documentId="native-document"
        fileName="Native document.pdf"
        canView
      />,
    );

    await waitFor(() => expect(apiClient.getLegacyMetadataHistory).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: /legacy metadata history/i })).not.toBeInTheDocument();
  });

  it('never checks for legacy history at all without the View Metadata History permission', async () => {
    render(
      <LegacyMetadataHistoryAction
        documentId={documentId}
        fileName={fileName}
        canView={false}
      />,
    );

    // Give any stray effect a tick to run, then confirm it genuinely never fired —
    // not just that the button hasn't rendered yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiClient.getLegacyMetadataHistory).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /legacy metadata history/i })).not.toBeInTheDocument();
  });

  it('distinguishes an unavailable archive check from a genuine no-history response', async () => {
    vi.mocked(apiClient.getLegacyMetadataHistory).mockRejectedValue(new Error('offline'));
    render(
      <LegacyMetadataHistoryAction
        documentId={documentId}
        fileName={fileName}
        canView
      />,
    );

    const unavailable = await screen.findByRole('button', { name: `Legacy metadata history unavailable for ${fileName}` });
    expect(apiClient.getLegacyMetadataHistory).toHaveBeenCalledWith(documentId);
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveAttribute('title', 'Legacy metadata history could not be checked');
  });
});
