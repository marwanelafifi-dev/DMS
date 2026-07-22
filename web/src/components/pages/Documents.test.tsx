import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Documents } from './Documents';
import { apiClient } from '../../utils/api';

function renderDocumentLibrary(initialEntry = '/documents') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Documents />
    </MemoryRouter>,
  );
}

describe('Document Library', () => {
  it('shows both mock folders', async () => {
    renderDocumentLibrary();

    expect(await screen.findByRole('button', { name: 'Folder 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Folder 2' })).toBeInTheDocument();
  });

  it('places the full-width folder section above the document table', async () => {
    renderDocumentLibrary();

    const folderSection = await screen.findByTestId('folder-section');
    const table = await screen.findByRole('table', { name: 'Documents' });

    expect(folderSection).toHaveClass('w-full');
    expect(folderSection.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the multiple file picker from the primary Upload button', async () => {
    const user = userEvent.setup();
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Upload files' }));

    expect(inputClick).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Select documents to upload')).toHaveAttribute('multiple');
  });

  it('shows the requested searchable metadata columns with Size last', async () => {
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
      'Size',
    ]);
    expect(screen.getByRole('textbox', { name: 'Search documents' })).toHaveAttribute('placeholder', 'Search');
    expect(screen.getAllByText('Operations').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Production', { selector: 'span' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\d{2} \w{3} 2026, \d{2}:\d{2}/).length).toBeGreaterThanOrEqual(2);
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

  it('enables bulk actions when a folder is selected', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    await user.click(await screen.findByRole('checkbox', { name: 'Select Folder 1' }));

    expect(screen.getByText('1 item selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for selected items' })).toBeInTheDocument();
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
    const upload = vi.spyOn(apiClient, 'uploadDocument').mockResolvedValue({ success: true });
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

  it('shows the destination on copied and moved folder cards', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Folder 1' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Destination folder' }), 'folder-2');
    await user.click(screen.getByRole('button', { name: 'Copy items' }));

    const copiedFolderCard = screen.getByRole('button', { name: 'Folder 1 Copy' }).closest('[data-folder-id]');
    expect(copiedFolderCard).toHaveTextContent('Inside Folder 2');

    await user.click(screen.getByRole('checkbox', { name: 'Select Folder 1' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Destination folder' }), 'folder-2');
    await user.click(screen.getByRole('button', { name: 'Move items' }));

    const movedFolderCard = screen.getByRole('button', { name: 'Folder 1' }).closest('[data-folder-id]');
    expect(movedFolderCard).toHaveTextContent('Inside Folder 2');
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
    await user.click(await screen.findByRole('checkbox', { name: 'Select Folder 1' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
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
    await user.click(await screen.findByRole('checkbox', { name: 'Select Folder 1' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.getByText(/selection contains a non-empty folder/i)).toBeInTheDocument();
  });

  it('disables uploads when every folder has been deleted', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Folder 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Folder 2' }));
    await user.click(screen.getByRole('button', { name: 'Actions for selected items' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete items' }));

    expect(screen.getByText('No folders available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeDisabled();
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

    await user.click(await screen.findByRole('button', { name: 'Preview Production Shift Handover.txt' }));

    expect(screen.getByRole('dialog', { name: 'Preview Production Shift Handover.txt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Folder 1' })).toBeInTheDocument();
    expect(screen.getByText(/Production Shift Handover/, { selector: 'pre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close document preview' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Actions for selected items' })).not.toBeInTheDocument();
  });

  it('keeps read-only document downloads working', async () => {
    const user = userEvent.setup();
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Download Production Shift Handover.txt' }));

    expect(downloadClick).toHaveBeenCalledOnce();
  });

  it('closes the preview and returns to the normal library view', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Preview Production Shift Handover.txt' }));
    await user.click(screen.getByRole('button', { name: 'Close document preview' }));

    expect(screen.queryByRole('dialog', { name: 'Preview Production Shift Handover.txt' })).not.toBeInTheDocument();
    expect(screen.getByText('Production Shift Handover.txt')).toBeInTheDocument();
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
    vi.spyOn(apiClient, 'getDocument').mockRejectedValueOnce(new Error('offline'));
    renderDocumentLibrary('/documents?preview=live-document-id');

    expect(await screen.findByRole('dialog', { name: 'Preview Document live-document-id' })).toBeInTheDocument();
    expect(screen.getByText(/server may be offline/i)).toBeInTheDocument();
  });
});
