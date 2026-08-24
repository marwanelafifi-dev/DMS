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
  taskType: 'correction',
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
    vi.spyOn(apiClient, 'updateTask').mockResolvedValue({ success: true, data: {} } as any);
    vi.spyOn(apiClient, 'getDropdownList').mockResolvedValue({ success: true, data: [{ label: 'Quality' }, { label: 'Review' }] } as any);
    vi.spyOn(apiClient, 'getPageAccessRoles').mockResolvedValue({ success: true, data: [{ role: 'Full Access', canViewPcar: true, canManageAllTasks: true, canCreateTasks: true }] } as any);
  });

  const renderHighlightedPcar = () => render(
    <MemoryRouter initialEntries={[`/tasks?highlight=${task.taskId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthContext.Provider value={auth}><Tasks /></AuthContext.Provider>
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
});
