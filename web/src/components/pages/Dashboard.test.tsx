import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { Dashboard } from './Dashboard';
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
  logout: vi.fn(),
};

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const tasks = [
  {
    taskId: 'task-open',
    title: 'Review calibration evidence',
    taskType: 'correction',
    assignedTo: TEST_USER_ID,
    assignedBy: 'manager-1',
    status: 'open',
    priority: 'critical',
    dueDate: inDays(3),
    createdAt: inDays(-1),
  },
  {
    taskId: 'task-overdue',
    title: 'Close out audit finding',
    taskType: 'audit_action',
    assignedTo: TEST_USER_ID,
    assignedBy: 'manager-1',
    status: 'in_progress',
    priority: 'high',
    dueDate: inDays(-2),
    createdAt: inDays(-9),
  },
  {
    taskId: 'task-someone-else',
    title: 'Not mine',
    taskType: 'correction',
    assignedTo: 'other-user',
    assignedBy: TEST_USER_ID,
    status: 'open',
    priority: 'low',
    dueDate: inDays(5),
    createdAt: inDays(-1),
  },
];

const documents = [
  {
    documentId: 'doc-mine-in-review',
    folderId: 'folder-1',
    name: 'Training Records Q3',
    title: 'Training Records Q3',
    fileName: 'training-records-q3.xlsx',
    fileSize: 2048,
    status: 'pending_approval',
    uploadedBy: TEST_USER_ID,
    uploadedAt: inDays(-1),
    updatedAt: inDays(-1),
  },
  {
    documentId: 'doc-mine-locked',
    folderId: 'folder-1',
    name: 'Calibration Procedure SOP-204',
    title: 'Calibration Procedure SOP-204',
    fileName: 'sop-204.pdf',
    fileSize: 4096,
    status: 'released',
    uploadedBy: TEST_USER_ID,
    uploadedAt: inDays(-4),
    updatedAt: inDays(-4),
    checkoutStatus: 'checked_out',
    checkedOutBy: TEST_USER_ID,
  },
];

const approvals = [
  {
    approvalId: 'approval-from-colleague',
    documentId: 'doc-colleague',
    document: { documentId: 'doc-colleague', name: 'Vendor Onboarding Form' },
    submittedBy: 'colleague-1',
    submittedByUser: { userId: 'colleague-1', fullName: 'Omar Hassan', email: 'omar@si-ware.com', role: 'Writer', isActive: true, createdAt: inDays(-30) },
    submittedAt: inDays(-1),
    approvalStatus: 'pending',
  },
  {
    // Submitted by the signed-in user, so it belongs in "My Submissions in Review".
    approvalId: 'approval-from-me',
    documentId: 'doc-mine-in-review',
    document: { documentId: 'doc-mine-in-review', name: 'Training Records Q3' },
    submittedBy: TEST_USER_ID,
    submittedAt: inDays(-1),
    approvalStatus: 'pending',
  },
];

function renderDashboard() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthContext.Provider value={authContextValue}>
        <Dashboard />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const metricValue = (label: string) => screen.getByTestId(`metric-${label}`).textContent;

describe('dashboard', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getTasks').mockResolvedValue({ success: true, data: tasks } as never);
    vi.spyOn(apiClient, 'getDocuments').mockResolvedValue({ success: true, data: documents } as never);
    vi.spyOn(apiClient, 'getPendingApprovals').mockResolvedValue({ success: true, data: approvals } as never);
  });

  it('derives personal metrics from the real API responses', async () => {
    renderDashboard();

    expect(await screen.findByText('My Open Tasks')).toBeInTheDocument();
    expect(apiClient.getTasks).toHaveBeenCalled();

    // Only the two tasks assigned to the signed-in user count, one of them overdue.
    expect(metricValue('My Open Tasks')).toBe('2');
    expect(metricValue('My Overdue Tasks')).toBe('1');
    // The approval the user submitted themselves is excluded from their review queue.
    expect(metricValue('Awaiting My Approval')).toBe('1');
    expect(metricValue('My Submissions in Review')).toBe('1');
    expect(metricValue('My Checked-Out Docs')).toBe('1');
  });

  it('lists only the current user tasks, incoming approvals, and own submissions', async () => {
    renderDashboard();

    expect(await screen.findByText('Review calibration evidence')).toBeInTheDocument();
    expect(screen.getByText('Close out audit finding')).toBeInTheDocument();
    expect(screen.queryByText('Not mine')).not.toBeInTheDocument();

    expect(screen.getByText('Vendor Onboarding Form')).toBeInTheDocument();
    expect(screen.getByText('Submitted by Omar Hassan')).toBeInTheDocument();
    expect(screen.getByText('Training Records Q3')).toBeInTheDocument();
  });

  it('still renders available panels when one endpoint fails', async () => {
    vi.spyOn(apiClient, 'getPendingApprovals').mockRejectedValue(new Error('Network Error'));
    renderDashboard();

    expect(await screen.findByText(/Could not load approvals/)).toBeInTheDocument();
    expect(screen.getByText('Review calibration evidence')).toBeInTheDocument();
    expect(screen.getByText('Nothing waiting on your review.')).toBeInTheDocument();
  });
});
