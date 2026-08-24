import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Documents } from './Documents';
import { apiClient, DEV_USER_ID, setCurrentUserId } from '../../utils/api';
import { mockLibraryFolders } from '../../fixtures/documentLibrary';
import { doclingApi } from '../../services/doclingApi';
import { AuthContext, type AuthContextValue } from '../../hooks/useAuth';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

const authContextValue: AuthContextValue = {
  user: {
    userId: TEST_USER_ID,
    fullName: 'System Admin',
    email: 'admin@si-ware.com',
    role: 'Admin',
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  isLoading: false,
  error: null,
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
};

function renderDocumentLibrary(initialEntry = '/documents') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthContext.Provider value={authContextValue}>
        <Documents />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('Document Library', () => {
  beforeEach(() => {
    // Documents.tsx reads DEV_USER_ID directly (not just through useAuth) for
    // default owner/permission checks — keep it in sync with the fixed test user.
    setCurrentUserId(TEST_USER_ID);
    vi.spyOn(apiClient, 'getFolders').mockResolvedValue({
      success: true,
      data: mockLibraryFolders,
    });
    vi.spyOn(apiClient, 'getDocuments').mockResolvedValue({
      success: true,
      data: [],
    });
    // Mock fixture documents are native New-DMS records by default, so the
    // optional KnowledgeTree archive action remains hidden unless a test opts
    // a specific fixture into legacy history.
    vi.spyOn(apiClient, 'getLegacyMetadataHistory').mockResolvedValue({
      success: true,
      data: {
        hasLegacyMetadataHistory: false,
        legacyDocumentId: null,
        sourceSystem: null,
        snapshots: [],
      },
    });
    vi.spyOn(apiClient, 'getUserPermissions').mockResolvedValue({
      success: true,
      data: [],
    });
    vi.spyOn(apiClient, 'getUsers').mockResolvedValue({
      success: true,
      data: [],
    });
    // These tests act as the seeded System Admin — grant every permission flag
    // so Upload/Rename/Delete/Submit-for-Approval stay enabled like they were
    // before per-permission UI gating existed, unless a test overrides this.
    vi.spyOn(apiClient, 'getMyEffectivePermissions').mockResolvedValue({
      success: true,
      data: {
        role: 'Admin',
        viewOnly: true, downloadReadOnly: true, downloadForEditing: true,
        upload: true, updateFile: true, updateFolder: true,
        createSubfolder: true, createParentFolder: true, addTask: true,
        deleteParentFolder: true, deleteSubfolder: true, deleteFile: true,
        submitForApproval: true, approve: true, reject: true, adminForceUnlock: true,
        copy: true, cut: true, downloadZip: true, fileCopy: true, fileCut: true,
      },
    });
    vi.spyOn(doclingApi, 'uploadDocument').mockImplementation(async (file) => ({
      id: file.name.length,
      filename: file.name,
      content: `# Parsed ${file.name}\n\nLocally extracted document content.`,
    }));
    vi.spyOn(doclingApi, 'convertDocument').mockImplementation(async (file) => ({
      filename: file.name,
      content: `# Parsed ${file.name}\n\nLocally extracted document content.`,
    }));
    // The Word/PowerPoint preview path health-checks the local sidecar before
    // attempting live PDF rendering — without this mock, the health check falls
    // through to a real `fetch()` against 127.0.0.1:8000 that hangs/times out
    // under jsdom. Defaulting to "unavailable" matches these tests' existing
    // assumption that Office files fall back to text/markdown extraction.
    vi.spyOn(doclingApi, 'isAvailable').mockResolvedValue(false);
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

  it('loads a complete sample-file pack into the upload dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getFolders).mockResolvedValue({
      success: true,
      data: [],
    });
    const createFolder = vi.spyOn(apiClient, 'createFolder').mockResolvedValue({
      success: true,
      data: {
        folderId: 'mock-files-folder',
        name: 'Mock Files',
        createdAt: '2026-07-27T12:00:00.000Z',
      },
    });
    const sampleFileNames = [
      'DMS-Sample-Text.txt',
      'DMS-Sample-Document.docx',
      'DMS-Sample-Spreadsheet.xlsx',
      'DMS-Sample-Presentation.pptx',
      'DMS-Sample-Report.pdf',
      'DMS-Sample-Image.png',
      'DMS-Sample-Photo.jpg',
    ];
    const fetchSample = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const fileName = decodeURIComponent(url.split('/').pop() ?? '');
      return new Response(`sample:${fileName}`, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    });
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Load sample files' }));

    expect(await screen.findByRole('button', { name: 'Upload 7 files' })).toBeInTheDocument();
    expect(createFolder).toHaveBeenCalledWith({
      name: 'Mock Files',
      description: 'Local multi-format documents for upload, preview, OCR, and workflow testing',
      classification: 'standard',
      ownerId: DEV_USER_ID,
      reuseExisting: true,
    });
    expect(screen.getByText(/Uploading to Mock Files/)).toBeInTheDocument();
    sampleFileNames.forEach((fileName) => {
      expect(screen.getByText(fileName)).toBeInTheDocument();
    });
    expect(fetchSample).toHaveBeenCalledTimes(sampleFileNames.length);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Mock Files' })).toHaveAttribute('aria-current', 'page');
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
    expect(screen.getByRole('textbox', { name: 'Search documents' })).toHaveAttribute('placeholder', 'Search name, extension, owner, tags...');
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

  it('renders icon-only Preview and a row actions menu for every visible file', async () => {
    renderDocumentLibrary();
    const table = await screen.findByRole('table', { name: 'Documents' });
    const previewButtons = within(table).getAllByRole('button', { name: /^Preview / });
    const rowMenuButtons = within(table).getAllByRole('button', { name: /^More actions for / });

    expect(previewButtons).toHaveLength(7);
    expect(rowMenuButtons).toHaveLength(7);
    previewButtons.forEach((button) => {
      expect(button).toHaveAttribute('title', 'Preview file');
      expect(button).toHaveTextContent('');
    });
    rowMenuButtons.forEach((button) => {
      expect(button).toHaveAttribute('title', 'More actions');
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
    await user.type(screen.getByLabelText(/Description/), 'Test upload batch');
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

  it('shows an uploaded image itself instead of Docling placeholder Markdown', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'createDocument').mockResolvedValue({
      success: true,
      data: { documentId: 'uploaded-image', status: 'draft' },
    });
    vi.spyOn(apiClient, 'uploadDocument').mockResolvedValue({
      success: true,
      data: { versionId: 'uploaded-image-version' },
    });
    vi.mocked(doclingApi.uploadDocument).mockResolvedValue({
      id: 81,
      filename: 'Si-Ware Logo.jpg',
      content: '<!-- image -->',
    });
    renderDocumentLibrary();
    const image = new File(['image-bytes'], 'Si-Ware Logo.jpg', { type: 'image/jpeg' });

    await user.upload(screen.getByLabelText('Select documents to upload'), image);
    await user.type(screen.getByLabelText(/Description/), 'Logo image upload');
    await user.click(screen.getByRole('button', { name: 'Upload 1 file' }));
    await user.click(await screen.findByRole('button', { name: 'Preview Si-Ware Logo.jpg' }));

    expect(screen.getByRole('img', { name: 'Si-Ware Logo.jpg' })).toBeInTheDocument();
    expect(screen.queryByText('<!-- image -->')).not.toBeInTheDocument();
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
    await user.type(screen.getByLabelText(/Description/), 'Pending conversion test');
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
    const fetchDocumentFile = vi.spyOn(apiClient, 'getDocumentFile').mockResolvedValue({
      blob: new Blob(['Persistent source restored after reload'], { type: persistedDocument.contentType }),
      fileName: persistedDocument.fileName,
    });

    const firstRender = renderDocumentLibrary();
    await user.upload(
      await screen.findByLabelText('Select documents to upload'),
      new File(['persistent upload'], persistedDocument.fileName, { type: persistedDocument.contentType }),
    );
    await user.type(screen.getByLabelText(/Description/), 'Persistent upload test');
    await user.click(screen.getByRole('button', { name: 'Upload 1 file' }));
    expect(await screen.findByText(persistedDocument.fileName)).toBeInTheDocument();

    firstRender.unmount();
    renderDocumentLibrary();

    expect(await screen.findByText(persistedDocument.fileName)).toBeInTheDocument();
    expect(apiClient.getDocuments).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: `Preview ${persistedDocument.fileName}` }));

    expect(await screen.findByText('Persistent source restored after reload', { selector: 'pre' })).toBeInTheDocument();
    expect(screen.queryByText('Preview unavailable')).not.toBeInTheDocument();
    expect(fetchDocumentFile).toHaveBeenCalledWith(
      persistedDocument.documentId,
      persistedDocument.currentVersionId,
      expect.any(AbortSignal),
    );
    expect(doclingApi.uploadDocument).toHaveBeenCalledOnce();
  });

  it('restores a persisted Office preview through Docling', async () => {
    const user = userEvent.setup();
    const persistedOfficeDocument = {
      documentId: 'persisted-presentation',
      currentVersionId: 'persisted-presentation-version',
      folderId: 'folder-1',
      name: 'Persisted Operations Review Q3',
      title: 'Persisted Operations Review Q3',
      fileName: 'Persisted Operations Review Q3.pptx',
      fileSize: 24,
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      status: 'draft',
      uploadedBy: '00000000-0000-0000-0000-000000000001',
      uploadedAt: '2026-07-27T08:00:00.000Z',
      createdAt: '2026-07-27T08:00:00.000Z',
      updatedAt: '2026-07-27T08:00:00.000Z',
    };
    vi.mocked(apiClient.getDocuments).mockResolvedValue({
      success: true,
      data: [persistedOfficeDocument],
    });
    const fetchDocumentFile = vi.spyOn(apiClient, 'getDocumentFile').mockResolvedValue({
      blob: new Blob(['stored-presentation'], { type: persistedOfficeDocument.contentType }),
      fileName: persistedOfficeDocument.fileName,
    });

    renderDocumentLibrary();
    await user.click(await screen.findByRole('button', { name: `Preview ${persistedOfficeDocument.fileName}` }));

    expect(await screen.findByRole('heading', { name: `Parsed ${persistedOfficeDocument.fileName}` })).toBeInTheDocument();
    expect(screen.queryByText('Preview unavailable')).not.toBeInTheDocument();
    expect(fetchDocumentFile).toHaveBeenCalledWith(
      persistedOfficeDocument.documentId,
      persistedOfficeDocument.currentVersionId,
      expect.any(AbortSignal),
    );
    expect(doclingApi.convertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: persistedOfficeDocument.fileName }),
      expect.any(AbortSignal),
    );
    expect(doclingApi.uploadDocument).not.toHaveBeenCalled();
  });

  it('routes a persisted macro-enabled Word document through PDF conversion', async () => {
    const user = userEvent.setup();
    const persistedMacroDocument = {
      documentId: 'persisted-word-macro',
      currentVersionId: 'persisted-word-macro-version',
      folderId: 'folder-1',
      name: 'PAC Phase 1 Test Report',
      title: 'PAC Phase 1 Test Report',
      fileName: 'PAC_Phase1_TestReport_20121216_rev1p0.docm',
      fileSize: 6584044,
      contentType: 'application/vnd.ms-word.document.macroenabled.12',
      status: 'draft',
      uploadedBy: TEST_USER_ID,
      uploadedAt: '2012-11-20T09:40:00.000Z',
      createdAt: '2012-11-20T09:40:00.000Z',
      updatedAt: '2012-12-18T13:36:00.000Z',
    };
    vi.mocked(apiClient.getDocuments).mockResolvedValue({
      success: true,
      data: [persistedMacroDocument],
    });
    vi.spyOn(apiClient, 'getDocumentFile').mockResolvedValue({
      blob: new Blob(['macro-enabled-word'], { type: persistedMacroDocument.contentType }),
      fileName: persistedMacroDocument.fileName,
    });
    vi.mocked(doclingApi.isAvailable).mockResolvedValue(true);
    const convertToPdf = vi.spyOn(doclingApi, 'convertToPdf').mockResolvedValue(
      new Blob(['converted-pdf'], { type: 'application/pdf' }),
    );

    renderDocumentLibrary();
    await user.click(await screen.findByRole('button', { name: `Preview ${persistedMacroDocument.fileName}` }));

    await waitFor(() => {
      expect(convertToPdf).toHaveBeenCalledWith(
        expect.any(Blob),
        persistedMacroDocument.fileName,
      );
    });
    expect(doclingApi.convertDocument).not.toHaveBeenCalled();
  });

  it('cancels a persisted Office conversion when the preview closes', async () => {
    const user = userEvent.setup();
    const persistedOfficeDocument = {
      documentId: 'pending-presentation',
      currentVersionId: 'pending-presentation-version',
      folderId: 'folder-1',
      name: 'Pending Operations Review',
      title: 'Pending Operations Review',
      fileName: 'Pending Operations Review.pptx',
      fileSize: 24,
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      status: 'draft',
      uploadedBy: '00000000-0000-0000-0000-000000000001',
      uploadedAt: '2026-07-27T08:00:00.000Z',
      createdAt: '2026-07-27T08:00:00.000Z',
      updatedAt: '2026-07-27T08:00:00.000Z',
    };
    vi.mocked(apiClient.getDocuments).mockResolvedValue({
      success: true,
      data: [persistedOfficeDocument],
    });
    vi.spyOn(apiClient, 'getDocumentFile').mockResolvedValue({
      blob: new Blob(['stored-presentation'], { type: persistedOfficeDocument.contentType }),
      fileName: persistedOfficeDocument.fileName,
    });
    let conversionSignal: AbortSignal | undefined;
    vi.mocked(doclingApi.convertDocument).mockImplementation((_file, signal) => {
      conversionSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    renderDocumentLibrary();
    await user.click(await screen.findByRole('button', { name: `Preview ${persistedOfficeDocument.fileName}` }));
    await waitFor(() => expect(doclingApi.convertDocument).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Close document preview' }));

    expect(conversionSignal?.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

  it('keeps native History separate and hides Metadata History for a native document', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Preview Production Shift Handover.txt' }));
    await waitFor(() => expect(apiClient.getLegacyMetadataHistory).toHaveBeenCalledWith('folder-1-txt'));

    expect(screen.getByRole('button', { name: 'View version history of Production Shift Handover.txt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /legacy metadata history/i })).not.toBeInTheDocument();
  });

  it('places imported Metadata History beside but separate from native Version History', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getLegacyMetadataHistory).mockResolvedValue({
      success: true,
      data: {
        hasLegacyMetadataHistory: true,
        legacyDocumentId: 230,
        sourceSystem: 'KnowledgeTree',
        snapshots: [{
          metadataVersionId: 9316,
          metadataVersion: 15,
          snapshotDate: '2018-12-10T12:09:47Z',
          legacyContentVersionId: 3390,
          isCurrentAtMigration: true,
          sourceSystem: 'KnowledgeTree',
          fields: [{ name: 'Authors', value: 'Mostafa Medhat' }],
        }],
      },
    });
    vi.spyOn(apiClient, 'getDocument').mockResolvedValue({
      success: true,
      data: { versions: [] },
    });
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'Preview Production Shift Handover.txt' }));
    const nativeHistory = screen.getByRole('button', { name: 'View version history of Production Shift Handover.txt' });
    const legacyHistory = await screen.findByRole('button', { name: 'View legacy metadata history of Production Shift Handover.txt' });
    expect(nativeHistory.compareDocumentPosition(legacyHistory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(legacyHistory);
    expect(screen.getByRole('heading', { name: 'Legacy Metadata History' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Version History' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: 'Legacy Metadata History' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Production Shift Handover.txt' })).toBeInTheDocument();

    await user.click(nativeHistory);
    expect(await screen.findByRole('heading', { name: 'Version History' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Legacy Metadata History' })).not.toBeInTheDocument();
  });

  it('fills the preview workspace and gives the PDF viewer all remaining space', async () => {
    const user = userEvent.setup();
    renderDocumentLibrary();
    await user.click(await screen.findByRole('button', { name: 'Preview Calibration Procedure SOP-204.pdf' }));

    const overlay = screen.getByTestId('document-preview-overlay');
    const body = screen.getByTestId('document-preview-body');
    const viewerWorkspace = document.getElementById('dms-printable-preview');

    expect(overlay).toHaveClass('fixed', 'inset-y-0', 'overflow-hidden');
    expect(body).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden');
    expect(viewerWorkspace).toHaveClass('h-full', 'w-full');
    expect(viewerWorkspace?.className).not.toMatch(/65vh|min-h-\[/);
    expect(document.body.style.overflow).toBe('hidden');

  });

  it('keeps read-only document downloads working', async () => {
    const user = userEvent.setup();
    let downloadedFileName = '';
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFileName = this.download;
    });
    renderDocumentLibrary();

    await user.click(await screen.findByRole('button', { name: 'More actions for Calibration Procedure SOP-204.pdf' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download' }));

    expect(downloadClick).toHaveBeenCalledOnce();
    expect(downloadedFileName).toBe('Calibration Procedure SOP-204.pdf');
  });

  it('keeps row selection unchanged when Preview or Download actions are used', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderDocumentLibrary();
    const checkbox = await screen.findByRole('checkbox', { name: 'Select Production Shift Handover.txt' });

    await user.click(screen.getByRole('button', { name: 'More actions for Production Shift Handover.txt' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download' }));
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
