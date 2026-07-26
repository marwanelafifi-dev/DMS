import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Documents } from './Documents';
import { apiClient } from '../../utils/api';
import { mockLibraryFolders } from '../../fixtures/documentLibrary';
import { doclingApi } from '../../services/doclingApi';

function renderDocumentLibrary(initialEntry = '/documents') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Documents />
    </MemoryRouter>,
  );
}

describe('Document Library', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getFolders').mockResolvedValue({
      success: true,
      data: mockLibraryFolders,
    });
    vi.spyOn(apiClient, 'getDocuments').mockResolvedValue({
      success: true,
      data: [],
    });
    vi.spyOn(doclingApi, 'uploadDocument').mockImplementation(async (file) => ({
      id: file.name.length,
      filename: file.name,
      content: `# Parsed ${file.name}\n\nLocally extracted document content.`,
    }));
  });

  it('shows both mock folders', async () => {
    renderDocumentLibrary();

    expect(await screen.findByRole('button', { name: 'Folder 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Folder 2' })).toBeInTheDocument();
  });

  it('keeps the folder section responsive next to the document table', async () => {
    renderDocumentLibrary();

    const folderSection = await screen.findByTestId('folder-section');
    const table = await screen.findByRole('table', { name: 'Documents' });

    expect(folderSection).toHaveClass('w-full', 'max-h-56', 'md:w-56', 'md:max-h-none');
    expect(folderSection).toBeInTheDocument();
    expect(table).toBeInTheDocument();
  });

  it('opens the multiple file picker from the primary Upload button', async () => {
    const user = userEvent.setup();
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Upload files' }));

    expect(inputClick).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Select documents to upload')).toHaveAttribute('multiple');
  });

  it('shows the requested searchable metadata columns without Size', async () => {
    renderDocumentLibrary();
    await screen.findByText('Production Shift Handover.txt');

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim());
    expect(headers).toEqual([
      '',
      'File name',
      'Type',
      'Folder',
      'Department',
      'Owner',
      'Creation date',
      'Modified date',
      'Tags',
      'Status',
      'Actions',
    ]);
    expect(screen.getByRole('textbox', { name: 'Search documents' })).toHaveAttribute('placeholder', 'Search');
    expect(screen.getAllByText('Operations').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Production', { selector: 'span' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\d{2} \w{3} 2026, \d{2}:\d{2}/).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps Actions as the final right-aligned column inside the table scroller', async () => {
    renderDocumentLibrary();
    const table = await screen.findByRole('table', { name: 'Documents' });
    const headers = within(table).getAllByRole('columnheader');
    const firstRowCells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell');

    expect(headers.at(-1)).toHaveTextContent('Actions');
    expect(headers.at(-1)).toHaveClass('text-right');
    expect(firstRowCells.at(-1)).toHaveClass('text-right');
    expect(table.parentElement).toHaveClass('overflow-x-auto');
    expect(within(table).queryByRole('columnheader', { name: 'Size' })).not.toBeInTheDocument();
  });

  it('renders icon-only Preview and Download actions for every visible file', async () => {
    renderDocumentLibrary();
    const table = await screen.findByRole('table', { name: 'Documents' });
    const previewButtons = within(table).getAllByRole('button', { name: /^Preview / });
    const downloadButtons = within(table).getAllByRole('button', { name: /^Download / });

    expect(previewButtons).toHaveLength(7);
    expect(downloadButtons).toHaveLength(7);
    previewButtons.forEach((button) => {
      expect(button).toHaveAttribute('title', 'Preview file');
      expect(button).toHaveTextContent('');
    });
    downloadButtons.forEach((button) => {
      expect(button).toHaveAttribute('title', 'Download file');
      expect(button).toHaveTextContent('');
    });
    expect(within(table).queryByText('View Only')).not.toBeInTheDocument();
    expect(within(table).queryByText('Download')).not.toBeInTheDocument();
  });

  it('searches case-insensitively across department, owner, tags, and folder', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    const search = await screen.findByRole('textbox', { name: 'Search documents' });

    await user.type(search, 'mOnA sAlEh');
    expect(screen.getByText('Quality Management Manual.docx')).toBeInTheDocument();
    expect(screen.queryByText('Production Shift Handover.txt')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'audit');
    expect(screen.getByText('Supplier Audit Checklist.doc')).toBeInTheDocument();
  });

  it('shows bulk actions for selected documents and lists every operation', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    await user.click(await screen.findByRole('checkbox', { name: 'Select Production Shift Handover.txt' }));
    expect(screen.getByText('1 item selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Move' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeEnabled();
  });

  it('shows folder context menu with rename, copy, cut, and delete options', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    const folder1Button = await screen.findByRole('button', { name: /Actions for Folder 1/i });
    await user.click(folder1Button);

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cut' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('selects all visible documents from the header and disables multi-item rename', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await screen.findByText('Production Shift Handover.txt');

    await user.click(screen.getByRole('checkbox', { name: 'Select all visible documents' }));
    expect(screen.getByText('7 items selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('lets users hide and restore optional metadata columns', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await screen.findByText('Production Shift Handover.txt');

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Owner' }));
    expect(screen.queryByRole('columnheader', { name: 'Owner' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Owner' }));
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();
  });

  it('uploads multiple files through the existing API flow into the selected folder', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'createDocument')
      .mockResolvedValueOnce({ success: true, data: { documentId: 'uploaded-one', status: 'draft' } })
      .mockResolvedValueOnce({ success: true, data: { documentId: 'uploaded-two', status: 'draft' } });
    const upload = vi.spyOn(apiClient, 'uploadDocument')
      .mockResolvedValueOnce({ success: true, data: { versionId: 'version-one' } })
      .mockResolvedValueOnce({ success: true, data: { versionId: 'version-two' } });
    renderDocumentLibrary();

    const files = [
      new File(['first'], 'Incoming Audit.pdf', { type: 'application/pdf' }),
      new File(['second'], 'Training Pack.pdf', { type: 'application/pdf' }),
    ];
    await user.upload(screen.getByLabelText('Select documents to upload'), files);
    await user.click(screen.getByRole('button', { name: 'Upload 2 files' }));

    expect(await screen.findByText('Incoming Audit.pdf')).toBeInTheDocument();
    expect(screen.getByText('Training Pack.pdf')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(1, 'uploaded-one', files[0]);
    expect(upload).toHaveBeenNthCalledWith(2, 'uploaded-two', files[1]);
    expect(doclingApi.uploadDocument).toHaveBeenCalledTimes(2);
    expect(doclingApi.uploadDocument).toHaveBeenNthCalledWith(1, files[0]);
    expect(doclingApi.uploadDocument).toHaveBeenNthCalledWith(2, files[1]);

    await user.click(screen.getByRole('button', { name: 'Preview Incoming Audit.pdf' }));
    expect(screen.getByRole('heading', { name: 'Parsed Incoming Audit.pdf' })).toBeInTheDocument();
    expect(screen.getByText('Locally extracted document content.')).toBeInTheDocument();
  });

  it('shows active Docling conversion progress while a file is being parsed', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'createDocument').mockResolvedValue({
      success: true,
      data: { documentId: 'processing-document', status: 'draft' },
    });
    vi.spyOn(apiClient, 'uploadDocument').mockResolvedValue({
      success: true,
      data: { versionId: 'processing-version' },
    });
    let finishParsing!: (document: { id: number; filename: string; content: string }) => void;
    vi.mocked(doclingApi.uploadDocument).mockImplementation(
      () => new Promise((resolve) => {
        finishParsing = resolve;
      }),
    );
    renderDocumentLibrary();
    const file = new File(['pending'], 'cpu-conversion.pdf', { type: 'application/pdf' });

    await user.upload(screen.getByLabelText('Select documents to upload'), file);
    await user.click(screen.getByRole('button', { name: 'Upload 1 file' }));

    const status = await screen.findByRole('status', { name: 'Converting document with Docling' });
    expect(status).toHaveTextContent('Converting cpu-conversion.pdf locally with Docling');
    expect(screen.getByRole('button', { name: 'Converting...' })).toBeDisabled();

    await act(async () => {
      finishParsing({
        id: 31,
        filename: file.name,
        content: '# CPU conversion complete',
      });
    });
    expect(await screen.findByText(file.name)).toBeInTheDocument();
  });

  it('restores an uploaded document from the API after the library remounts', async () => {
    const user = userEvent.setup();
    const uploadedAt = '2026-07-26T10:00:00.000Z';
    const persistedDocument = {
      documentId: 'persisted-upload',
      currentVersionId: 'persisted-version',
      folderId: 'folder-1',
      name: 'Persistent Upload',
      title: 'Persistent Upload',
      fileName: 'Persistent Upload.txt',
      fileSize: 18,
      contentType: 'text/plain',
      status: 'draft',
      uploadedBy: '00000000-0000-0000-0000-000000000001',
      uploadedAt,
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
    };
    vi.mocked(apiClient.getDocuments)
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValue({ success: true, data: [persistedDocument] });
    vi.spyOn(apiClient, 'createDocument').mockResolvedValue({
      success: true,
      data: { documentId: persistedDocument.documentId, status: 'draft', createdAt: uploadedAt },
    });
    vi.spyOn(apiClient, 'uploadDocument').mockResolvedValue({
      success: true,
      data: { versionId: persistedDocument.currentVersionId },
    });

    const firstRender = renderDocumentLibrary();
    await user.upload(
      await screen.findByLabelText('Select documents to upload'),
      new File(['persistent upload'], persistedDocument.fileName, { type: persistedDocument.contentType }),
    );
    await user.click(screen.getByRole('button', { name: 'Upload 1 file' }));
    expect(await screen.findByText(persistedDocument.fileName)).toBeInTheDocument();

    firstRender.unmount();
    renderDocumentLibrary();

    expect(await screen.findByText(persistedDocument.fileName)).toBeInTheDocument();
    expect(apiClient.getDocuments).toHaveBeenCalledTimes(2);
  });

  it('copies selected documents to a destination with a safe name', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Production Shift Handover.txt' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Destination folder' }), 'folder-2');
    await user.click(screen.getByRole('button', { name: 'Copy items' }));
    await user.click(screen.getByRole('button', { name: 'Folder 2' }));

    expect(await screen.findByText('Production Shift Handover Copy.txt')).toBeInTheDocument();
  });

  it('moves selected documents to the chosen folder', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Production Shift Handover.txt' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Destination folder' }), 'folder-2');
    await user.click(screen.getByRole('button', { name: 'Move items' }));

    expect(screen.queryByText('Production Shift Handover.txt')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Folder 2' }));
    expect(await screen.findByText('Production Shift Handover.txt')).toBeInTheDocument();
  });

  it('copies folders through the context menu to a destination', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    const folder1Menu = await screen.findByRole('button', { name: /Actions for Folder 1/i });
    await user.click(folder1Menu);
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Destination folder' }), 'folder-2');
    await user.click(screen.getByRole('button', { name: 'Copy items' }));

    expect(await screen.findByRole('button', { name: 'Folder 1 Copy' })).toBeInTheDocument();
  });

  it('deletes selected documents only after confirmation', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Production Shift Handover.txt' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText(/permanently removes 1 selected item/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete items' }));

    expect(screen.queryByText('Production Shift Handover.txt')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for selected items' })).not.toBeInTheDocument();
  });

  it('renames one selected document while preserving its extension', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Production Shift Handover.txt' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const nameInput = screen.getByRole('textbox', { name: 'New name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Shift Handover.txt');
    await user.click(screen.getByRole('button', { name: 'Rename item' }));

    expect(await screen.findByText('Updated Shift Handover.txt')).toBeInTheDocument();
    expect(screen.queryByText('Production Shift Handover.txt')).not.toBeInTheDocument();
  });

  it('requires an explicit confirmation before changing a file extension', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Production Shift Handover.txt' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const nameInput = screen.getByRole('textbox', { name: 'New name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Shift Handover.pdf');
    await user.click(screen.getByRole('button', { name: 'Rename item' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/extension can make the file unreadable/i);
    expect(screen.getByText('Production Shift Handover.txt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change extension' }));
    expect(await screen.findByText('Updated Shift Handover.pdf')).toBeInTheDocument();
  });

  it('renames a selected folder and keeps its documents associated', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Actions for Folder 1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const nameInput = screen.getByRole('textbox', { name: 'New name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Operations Records');
    await user.click(screen.getByRole('button', { name: 'Rename item' }));

    expect(screen.getByRole('button', { name: 'Operations Records' })).toBeInTheDocument();
    expect(screen.getAllByText('Operations Records').length).toBeGreaterThan(1);
  });

  it('warns before deleting a selected non-empty folder', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Actions for Folder 1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.getByText(/selection contains a non-empty folder/i)).toBeInTheDocument();
  });

  it('disables uploads when every folder has been deleted', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Actions for Folder 1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete items' }));
    await user.click(await screen.findByRole('button', { name: 'Actions for Folder 2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete items' }));

    expect(screen.getByText('No folders available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeDisabled();
  });

  it('does not add folder selection checkboxes', async () => {
    renderDocumentLibrary();
    await screen.findByRole('button', { name: 'Folder 1' });

    expect(screen.queryByRole('checkbox', { name: 'Select Folder 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Select Folder 2' })).not.toBeInTheDocument();
  });

  it('shows only the documents in the selected folder', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    expect(await screen.findByText('Production Shift Handover.txt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Folder 2' }));

    expect(await screen.findByText('Incident Response Notes.txt')).toBeInTheDocument();
    expect(screen.queryByText('Production Shift Handover.txt')).not.toBeInTheDocument();
  });

  it('opens a document preview without leaving the library', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    const previewButton = await screen.findByRole('button', { name: 'Preview Production Shift Handover.txt' });
    await user.click(previewButton);

    const dialog = screen.getByRole('dialog', { name: 'Production Shift Handover.txt' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Folder 1' })).toBeInTheDocument();
    expect(screen.getByText(/Production Shift Handover/, { selector: 'pre' })).toBeInTheDocument();
    expect(screen.getByText('3.4 KB')).toBeInTheDocument();
    expect(within(dialog).getByText('Daily production handover notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close document preview' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Actions for selected items' })).not.toBeInTheDocument();
  });

  it('fills the preview workspace and gives the PDF viewer all remaining space', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await user.click(await screen.findByRole('button', { name: 'Preview Calibration Procedure SOP-204.pdf' }));

    const overlay = screen.getByTestId('document-preview-overlay');
    const body = screen.getByTestId('document-preview-body');
    const viewer = screen.getByTitle('PDF preview of Calibration Procedure SOP-204.pdf');

    expect(overlay).toHaveClass('fixed', 'inset-y-0', 'overflow-hidden');
    expect(body).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden');
    expect(viewer).toHaveClass('block', 'h-full', 'w-full');
    expect(viewer.className).not.toMatch(/65vh|min-h-\[/);
    expect(document.body.style.overflow).toBe('hidden');

  });

  it('keeps read-only document downloads working', async () => {
    const user = userEvent.setup();
    let downloadedFileName = '';
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFileName = this.download;
    });
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Download Calibration Procedure SOP-204.pdf' }));

    expect(downloadClick).toHaveBeenCalledOnce();
    expect(downloadedFileName).toBe('Calibration Procedure SOP-204.pdf');
  });

  it('keeps row selection unchanged when Preview or Download actions are used', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderDocumentLibrary();
    const checkbox = await screen.findByRole('checkbox', { name: 'Select Production Shift Handover.txt' });

    await user.click(screen.getByRole('button', { name: 'Download Production Shift Handover.txt' }));
    expect(checkbox).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Preview Production Shift Handover.txt' }));
    await user.click(screen.getByRole('button', { name: 'Close document preview' }));
    expect(checkbox).not.toBeChecked();
  });

  it('closes the preview and returns to the normal library view', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    const previewButton = await screen.findByRole('button', { name: 'Preview Production Shift Handover.txt' });
    await user.click(previewButton);
    await user.click(screen.getByRole('button', { name: 'Close document preview' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Production Shift Handover.txt')).toBeInTheDocument();
    expect(previewButton).toHaveFocus();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('keeps the name filter working with mock documents', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await screen.findByText('Production Shift Handover.txt');

    await user.type(screen.getByRole('textbox', { name: 'Search documents' }), 'Calibration Procedure');

    expect(screen.getByText('Calibration Procedure SOP-204.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Quality Management Manual.docx')).not.toBeInTheDocument();
  });

  it('keeps the status filter working with mock documents', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await screen.findByText('Production Shift Handover.txt');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter documents by status' }), 'draft');

    expect(screen.getByText('Operations Review Q2.pptx')).toBeInTheDocument();
    expect(screen.queryByText('Calibration Procedure SOP-204.pdf')).not.toBeInTheDocument();
  });

  it('shows an inline fallback when a linked live preview cannot be loaded', async () => {
    vi.spyOn(apiClient, 'getDocument').mockRejectedValue(new Error('offline'));
    renderDocumentLibrary('/documents?preview=live-document-id');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/server may be offline/i)).toBeInTheDocument();
  });
});
