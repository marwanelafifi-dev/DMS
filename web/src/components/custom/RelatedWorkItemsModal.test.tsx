import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { RelatedPcarsModal } from './RelatedPcarsModal';
import { RelatedTasksModal } from './RelatedTasksModal';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe('related work item separation', () => {
  it('never renders a PCAR in Related Tasks, even if a stale API response includes it', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'getTasksByDocument').mockResolvedValue({
      success: true,
      data: [
        { taskId: 'normal-task', title: 'Review backup procedure', taskType: 'review', taskNumber: 'TASK-000001', status: 'open', createdAt: '2026-11-11T00:00:00Z' },
        { taskId: 'pcar-finding', title: 'Audit finding', taskType: 'pcar', status: 'open', createdAt: '2026-11-11T00:00:00Z' },
      ],
    } as any);

    render(<MemoryRouter><RelatedTasksModal documentId="document-1" fileName="Backup procedure" onClose={vi.fn()} /><LocationProbe /></MemoryRouter>);

    expect(await screen.findByText('Review backup procedure')).toBeInTheDocument();
    expect(screen.getByText('Task No. TASK-000001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Task No. TASK-000001' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks?highlight=normal-task');
    await waitFor(() => expect(screen.queryByText('Audit finding')).not.toBeInTheDocument());
  });

  it('renders only audit findings and their PCAR number in Related PCARs', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'getPcarsByDocument').mockResolvedValue({
      success: true,
      data: [
        { taskId: 'pcar-finding', title: 'Audit finding', taskType: 'pcar', findingNumber: 'PCAR-000337', status: 'open', createdAt: '2026-11-11T00:00:00Z' },
        { taskId: 'normal-task', title: 'Review backup procedure', taskType: 'review', status: 'open', createdAt: '2026-11-11T00:00:00Z' },
      ],
    } as any);

    render(<MemoryRouter><RelatedPcarsModal documentId="document-1" fileName="Backup procedure" onClose={vi.fn()} /><LocationProbe /></MemoryRouter>);

    expect(await screen.findByText('Audit finding')).toBeInTheDocument();
    expect(screen.getByText('PCAR No. PCAR-000337')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'PCAR No. PCAR-000337' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/pcars?highlight=pcar-finding');
    await waitFor(() => expect(screen.queryByText('Review backup procedure')).not.toBeInTheDocument());
  });
});
