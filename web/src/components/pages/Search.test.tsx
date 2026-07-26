import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doclingApi } from '../../services/doclingApi';
import { apiClient } from '../../utils/api';
import { Search } from './Search';

function renderSearch(initialEntry = '/search') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/search" element={<Search />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('parsed document search', () => {
  beforeEach(() => {
    vi.spyOn(doclingApi, 'searchDocuments').mockResolvedValue([
      {
        id: 7,
        filename: 'calibration-record.docx',
        content: '# Calibration record\n\nTorque verification evidence.',
        created_at: '2026-07-26 12:00:00',
      },
    ]);
  });

  it('loads the navbar query from the URL and displays matching parsed files', async () => {
    const user = userEvent.setup();
    renderSearch('/search?q=torque%20verification');

    expect(await screen.findByText('calibration-record.docx')).toBeInTheDocument();
    expect(doclingApi.searchDocuments).toHaveBeenCalledWith(
      'torque verification',
      expect.any(AbortSignal),
    );

    await user.click(screen.getByRole('button', { name: 'View parsed calibration-record.docx' }));

    expect(screen.getByRole('heading', { name: 'Calibration record' })).toBeInTheDocument();
    expect(screen.getByText('Torque verification evidence.')).toBeInTheDocument();
  });

  it('keeps the existing filtered DMS metadata search available', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'searchDocuments').mockResolvedValue({
      success: true,
      data: [
        {
          documentId: 'dms-document-1',
          folderId: 'folder-1',
          currentVersionId: 'version-1',
          name: 'Quality Handbook',
          title: 'Quality Handbook',
          fileName: 'quality-handbook.pdf',
          fileSize: 4096,
          contentType: 'application/pdf',
          status: 'released',
          uploadedBy: 'owner-1',
          uploadedAt: '2026-07-20T10:00:00.000Z',
          updatedAt: '2026-07-20T10:00:00.000Z',
        },
      ],
    });
    renderSearch('/search?q=quality');

    await screen.findByText('calibration-record.docx');
    await user.click(screen.getByText('Advanced DMS metadata filters'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'released');
    await user.click(screen.getByRole('button', { name: 'Search DMS metadata' }));

    expect(apiClient.searchDocuments).toHaveBeenCalledWith(
      'quality',
      expect.objectContaining({ status: 'released' }),
    );
    expect(await screen.findByText('Quality Handbook')).toBeInTheDocument();
  });
});
