import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../hooks/useAuth';
import { apiClient, setCurrentUserId } from '../../utils/api';
import { Tasks } from './Tasks';

const userId = '00000000-0000-0000-0000-000000000001';
const task = {
  taskId: '10000000-0000-0000-0000-000000000001',
  title: 'PCAR modal behavior probe',
  description: 'Issue description',
  tags: ['Quality'],
  taskType: 'pcar',
  approvalId: '30000000-0000-0000-0000-000000000001',
  documentId: '20000000-0000-0000-0000-000000000001',
  assignedToId: userId,
  assignedBy: userId,
  status: 'open',
  priority: 'medium',
  dueDate: '2026-12-31',
  createdAt: '2026-01-01T00:00:00Z',
};

const auth: AuthContextValue = {
  user: { userId, fullName: 'System Admin', email: 'system@si-ware.com', role: 'Full Access', isActive: true, createdAt: '2026-01-01' },
  isLoading: false,
  error: null,
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  logout: vi.fn(),
};

describe('PCAR true modal behavior', () => {
  beforeEach(() => {
    setCurrentUserId(userId);
    vi.spyOn(apiClient, 'getTasks').mockResolvedValue({ success: true, data: [task], totalCount: 1, totalPages: 1 } as any);
    vi.spyOn(apiClient, 'getUsers').mockResolvedValue({ success: true, data: [{ userId, fullName: 'System Admin' }] } as any);
    vi.spyOn(apiClient, 'getGroups').mockResolvedValue({ success: true, data: [] } as any);
    vi.spyOn(apiClient, 'getGroupsForUser').mockResolvedValue({ success: true, data: [] } as any);
    vi.spyOn(apiClient, 'getDocuments').mockResolvedValue({ success: true, data: [{ documentId: task.documentId, folderId: 'folder', name: 'document.pdf', title: 'document.pdf', fileName: 'document.pdf', currentVersionId: 'version' }] } as any);
    vi.spyOn(apiClient, 'getFolders').mockResolvedValue({ success: true, data: [] } as any);
    vi.spyOn(apiClient, 'getTaskAttachments').mockResolvedValue({ success: true, data: [] } as any);
    vi.spyOn(apiClient, 'getTask').mockResolvedValue({ success: true, data: { ...task, linkedDocuments: [], linkedFolders: [] } } as any);
    vi.spyOn(apiClient, 'updateTask').mockResolvedValue({ success: true, data: {} } as any);
    vi.spyOn(apiClient, 'verifyPcar').mockResolvedValue({ success: true, data: {} } as any);
    vi.spyOn(apiClient, 'getDropdownList').mockResolvedValue({ success: true, data: [{ label: 'Quality' }, { label: 'Review' }] } as any);
    vi.spyOn(apiClient, 'getPageAccessRoles').mockResolvedValue({ success: true, data: [{ role: 'Full Access', canViewPcar: true, canManageAllTasks: true, canCreateTasks: true }] } as any);
  });

  const renderHighlightedPcar = () => render(
    <MemoryRouter initialEntries={[`/pcars?highlight=${task.taskId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthContext.Provider value={auth}><Tasks mode="pcar" /></AuthContext.Provider>
    </MemoryRouter>,
  );

  it('does not close on backdrop click and closes from its X control', async () => {
    const user = userEvent.setup();
    renderHighlightedPcar();

    expect(await screen.findByRole('heading', { name: task.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag Quality' })).toBeInTheDocument();
    const overlay = document.querySelector<HTMLElement>('[data-modal-overlay="true"]');
    expect(overlay).not.toBeNull();
    await user.click(overlay!);
    expect(screen.getByText('Issue Description')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('Issue Description')).not.toBeInTheDocument());
  });

  it('closes on Escape', async () => {
    renderHighlightedPcar();
    expect(await screen.findByRole('heading', { name: task.title })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Issue Description')).not.toBeInTheDocument());
  });

  it('saves tag changes and displays them again after reopening the PCAR', async () => {
    const user = userEvent.setup();
    let storedTags = ['Quality'];
    vi.mocked(apiClient.getTasks).mockImplementation(async () => ({ success: true, data: [{ ...task, tags: storedTags }], totalCount: 1, totalPages: 1 } as any));
    vi.mocked(apiClient.updateTask).mockImplementation(async (_taskId, payload) => {
      storedTags = payload.tags;
      return { success: true, data: {} } as any;
    });
    renderHighlightedPcar();

    expect(await screen.findByRole('heading', { name: task.title })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Add tag Review' }));
    await user.click(screen.getByRole('button', { name: 'Save Documentation' }));
    await waitFor(() => expect(apiClient.updateTask).toHaveBeenCalledWith(task.taskId, expect.objectContaining({ tags: ['Quality', 'Review'] })));

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(await screen.findByText(task.title));
    expect(await screen.findByRole('button', { name: 'Remove tag Review' })).toBeInTheDocument();
  });

  it('requires evidence before a PCAR can be submitted for verification', async () => {
    const pcar = { ...task, taskType: 'pcar', approvalId: undefined, status: 'open' };
    vi.mocked(apiClient.getTasks).mockResolvedValue({ success: true, data: [pcar], totalCount: 1, totalPages: 1 } as any);
    vi.mocked(apiClient.getTask).mockResolvedValue({ success: true, data: { ...pcar, linkedDocuments: [], linkedFolders: [] } } as any);
    render(
      <MemoryRouter initialEntries={[`/pcars?highlight=${pcar.taskId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={auth}><Tasks mode="pcar" /></AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/No evidence attached yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit evidence for verification' })).toBeDisabled();
  });

  it('keeps normal task completion separate from PCAR fields and requires an attachment only for evidence actions', async () => {
    const normalTask = { ...task, taskType: 'correction', approvalId: undefined, title: 'Correct a document title' };
    vi.mocked(apiClient.getTasks).mockResolvedValue({ success: true, data: [normalTask], totalCount: 1, totalPages: 1 } as any);
    vi.mocked(apiClient.getTask).mockResolvedValue({ success: true, data: { ...normalTask, linkedDocuments: [], linkedFolders: [] } } as any);
    render(
      <MemoryRouter initialEntries={[`/tasks?highlight=${normalTask.taskId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={auth}><Tasks /></AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: normalTask.title })).toBeInTheDocument();
    expect(screen.queryByText('Root Cause Analysis')).not.toBeInTheDocument();
    expect(screen.queryByText('PCAR Status')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Completion comment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add attachment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete task' })).toBeDisabled();
  });

  it('allows a General task to complete without an attachment', async () => {
    const normalTask = { ...task, taskType: 'task', approvalId: undefined, title: 'Review team documents' };
    vi.mocked(apiClient.getTasks).mockResolvedValue({ success: true, data: [normalTask], totalCount: 1, totalPages: 1 } as any);
    vi.mocked(apiClient.getTask).mockResolvedValue({ success: true, data: { ...normalTask, linkedDocuments: [], linkedFolders: [] } } as any);
    render(
      <MemoryRouter initialEntries={[`/tasks?highlight=${normalTask.taskId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={auth}><Tasks /></AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: normalTask.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete task' })).toBeEnabled();
  });

  it('shows Quality/Auditor verification controls only when the dedicated permission is granted', async () => {
    const pcar = { ...task, taskType: 'pcar', approvalId: undefined, status: 'submitted' };
    vi.mocked(apiClient.getTasks).mockResolvedValue({ success: true, data: [pcar], totalCount: 1, totalPages: 1 } as any);
    vi.mocked(apiClient.getTask).mockResolvedValue({ success: true, data: { ...pcar, linkedDocuments: [], linkedFolders: [] } } as any);
    vi.mocked(apiClient.getTaskAttachments).mockResolvedValue({ success: true, data: [{ attachmentId: 'evidence', fileName: 'evidence.pdf', createdAt: '2026-01-01' }] } as any);
    vi.mocked(apiClient.getPageAccessRoles).mockResolvedValue({ success: true, data: [{ role: 'Full Access', canViewPcar: true, canManageAllTasks: true, canCreateTasks: true, canVerifyPcars: true }] } as any);
    render(
      <MemoryRouter initialEntries={[`/pcars?highlight=${pcar.taskId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={auth}><Tasks mode="pcar" /></AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Approve and close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return with notes' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Corrective-action effectiveness/i)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Return with notes' }));
    expect(apiClient.verifyPcar).not.toHaveBeenCalled();
  });

  it('closes the folder search results when the user clicks elsewhere or presses Escape', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getFolders).mockResolvedValue({
      success: true,
      data: [{ folderId: 'folder-1', name: 'Quality Management System' }],
    } as any);
    vi.mocked(apiClient.getPageAccessRoles).mockResolvedValue({
      success: true,
      data: [{ role: 'Full Access', canViewPcar: true, canManageAllTasks: true, canCreateTasks: true, canCreatePcars: true }],
    } as any);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={auth}><Tasks mode="pcar" /></AuthContext.Provider>
      </MemoryRouter>,
    );

    const raisePcar = await screen.findByRole('button', { name: /Raise PCAR/i });
    await user.click(raisePcar);
    const folderSearch = screen.getByPlaceholderText('Search folder name or full path...');
    await user.click(folderSearch);
    expect(await screen.findByRole('button', { name: 'Quality Management System' })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Quality Management System' })).not.toBeInTheDocument());

    await user.click(folderSearch);
    expect(await screen.findByRole('button', { name: 'Quality Management System' })).toBeInTheDocument();
    fireEvent.keyDown(folderSearch, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Quality Management System' })).not.toBeInTheDocument());
  });

  it('limits PCAR files to released documents in the selected folder', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getFolders).mockResolvedValue({
      success: true,
      data: [
        { folderId: 'quality-folder', name: 'Quality' },
        { folderId: 'engineering-folder', name: 'Engineering' },
      ],
    } as any);
    vi.mocked(apiClient.getDocuments).mockResolvedValue({
      success: true,
      data: [
        { documentId: 'released-quality', folderId: 'quality-folder', name: 'released-procedure.pdf', title: 'Released procedure', fileName: 'released-procedure.pdf', status: 'released' },
        { documentId: 'draft-quality', folderId: 'quality-folder', name: 'draft-procedure.pdf', title: 'Draft procedure', fileName: 'draft-procedure.pdf', status: 'draft' },
        { documentId: 'released-engineering', folderId: 'engineering-folder', name: 'released-design.pdf', title: 'Released design', fileName: 'released-design.pdf', status: 'released' },
      ],
    } as any);
    vi.mocked(apiClient.getPageAccessRoles).mockResolvedValue({
      success: true,
      data: [{ role: 'Full Access', canViewPcar: true, canManageAllTasks: true, canCreateTasks: true, canCreatePcars: true }],
    } as any);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={auth}><Tasks mode="pcar" /></AuthContext.Provider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: /Raise PCAR/i }));
    await user.click(screen.getByPlaceholderText('Search folder name or full path...'));
    await user.click(await screen.findByRole('button', { name: 'Quality' }));

    await user.click(screen.getByPlaceholderText('Search file name, folder path, or Document ID...'));
    expect(await screen.findByRole('button', { name: /Quality \/ Released procedure/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draft procedure/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Engineering \/ Released design/i })).not.toBeInTheDocument();
  });

  it('shows only released files and supports document-ID search when no folder is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getDocuments).mockResolvedValue({
      success: true,
      data: [
        { documentId: 'released-file', folderId: 'folder', name: 'released.pdf', title: 'Released file', fileName: 'released.pdf', originalDocumentId: 'SWS-25120007', status: 'released' },
        { documentId: 'draft-file', folderId: 'folder', name: 'draft.pdf', title: 'Draft file', fileName: 'draft.pdf', originalDocumentId: 'SWS-25120008', status: 'draft' },
      ],
    } as any);
    vi.mocked(apiClient.getPageAccessRoles).mockResolvedValue({
      success: true,
      data: [{ role: 'Full Access', canViewPcar: true, canManageAllTasks: true, canCreateTasks: true, canCreatePcars: true }],
    } as any);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={auth}><Tasks mode="pcar" /></AuthContext.Provider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: /Raise PCAR/i }));
    const documentSearch = screen.getByPlaceholderText('Search file name, folder path, or Document ID...');
    await user.type(documentSearch, 'SWS-25120007');

    expect(await screen.findByRole('button', { name: /Released file.*SWS-25120007/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draft file/i })).not.toBeInTheDocument();
  });

  it('lets a normal task link any file from the selected folder and dismisses the file picker', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getFolders).mockResolvedValue({
      success: true,
      data: [
        { folderId: 'quality-folder', name: 'Quality' },
        { folderId: 'engineering-folder', name: 'Engineering' },
      ],
    } as any);
    vi.mocked(apiClient.getDocuments).mockResolvedValue({
      success: true,
      data: [
        { documentId: 'draft-quality', folderId: 'quality-folder', name: 'draft-procedure.pdf', title: 'Draft procedure', fileName: 'draft-procedure.pdf', status: 'draft' },
        { documentId: 'released-engineering', folderId: 'engineering-folder', name: 'released-design.pdf', title: 'Released design', fileName: 'released-design.pdf', status: 'released' },
      ],
    } as any);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={auth}><Tasks mode="tasks" /></AuthContext.Provider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: /New Task/i }));
    await user.click(screen.getByPlaceholderText('Search folder name or full path...'));
    await user.click(await screen.findByRole('button', { name: 'Quality' }));

    const documentSearch = screen.getByPlaceholderText('Search file name, folder path, or Document ID...');
    await user.click(documentSearch);
    expect(await screen.findByRole('button', { name: /Quality \/ Draft procedure/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Engineering \/ Released design/i })).not.toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Quality \/ Draft procedure/i })).not.toBeInTheDocument());
    await user.click(documentSearch);
    fireEvent.keyDown(documentSearch, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Quality \/ Draft procedure/i })).not.toBeInTheDocument());
  });

  it('lets a normal task search every file by document ID when no folder is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getDocuments).mockResolvedValue({
      success: true,
      data: [{ documentId: 'draft-file', folderId: 'folder', name: 'draft.pdf', title: 'Draft file', fileName: 'draft.pdf', originalDocumentId: 'SWS-25120008', status: 'draft' }],
    } as any);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthContext.Provider value={auth}><Tasks mode="tasks" /></AuthContext.Provider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: /New Task/i }));
    const documentSearch = screen.getByPlaceholderText('Search file name, folder path, or Document ID...');
    await user.type(documentSearch, 'SWS-25120008');
    expect(await screen.findByRole('button', { name: /Draft file.*SWS-25120008/i })).toBeInTheDocument();
  });
});
