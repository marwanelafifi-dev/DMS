import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { AuditTrail } from './AuditTrail';

afterEach(() => vi.restoreAllMocks());

it('requests notification failures across the full ledger and labels the system actor', async () => {
  const user = userEvent.setup();
  const getAuditTrail = vi.spyOn(apiClient, 'getAuditTrail').mockImplementation(async (params) => ({
    success: true,
    data: params.action ? [{
      logId: 'failed-email',
      userId: '00000000-0000-0000-0000-000000000000',
      action: 'NOTIFICATION_NOT_SENT',
      metadata: { Channel: 'email', Outcome: 'failed' },
      createdAt: '2026-11-28T06:00:00Z',
    }] : [],
    totalPages: params.action ? 1 : 2,
  }));
  vi.spyOn(apiClient, 'getUsers').mockResolvedValue({ success: true, data: [] });

  render(<AuditTrail />);
  await user.click(await screen.findByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(getAuditTrail).toHaveBeenLastCalledWith({ page: 2, pageSize: 25, action: undefined }));
  await user.selectOptions(await screen.findByRole('combobox'), 'NOTIFICATION_NOT_SENT');

  expect(await screen.findByText('System')).toBeInTheDocument();
  expect(screen.getByText('Channel: email, Outcome: failed')).toBeInTheDocument();
  expect(getAuditTrail).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, action: 'NOTIFICATION_NOT_SENT' });
});
