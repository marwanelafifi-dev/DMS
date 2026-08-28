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
        <Route path="/documents" element={<div>document library preview</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const libraryDocument = {
  documentId: 'dms-document-7',
  folderId: 'folder-1',
  currentVersionId: 'version-7',
  name: 'calibration-record',
  title: 'calibration-record',
  fileName: 'calibration-record.docx',
  fileSize: 4096,
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  status: 'released' as const,
  uploadedBy: 'owner-1',
  uploadedAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
};

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
    vi.spyOn(apiClient, 'getDocuments').mockResolvedValue({ success: true, data: [libraryDocument] });
    vi.spyOn(apiClient, 'getFolders').mockResolvedValue({ success: true, data: [] });
    vi.spyOn(apiClient, 'getUsers').mockResolvedValue({ success: true, data: [] });
  });

  it('loads the navbar query from the URL and displays matching parsed files', async () => {
    renderSearch('/search?q=torque%20verification');

    expect(await screen.findByText('calibration-record.docx')).toBeInTheDocument();
    expect(doclingApi.searchDocuments).toHaveBeenCalledWith(
      'torque verification',
      expect.any(AbortSignal),
    );
  });

  it('opens a matching parsed file in the Document Library preview', async () => {
    const user = userEvent.setup();
    renderSearch('/search?q=torque%20verification');

    await screen.findByText('calibration-record.docx');
    await user.click(
      await screen.findByRole('button', { name: 'Open calibration-record.docx in Document Library' }),
    );

    expect(await screen.findByText('document library preview')).toBeInTheDocument();
  });

  it('hides OCR rows that no longer have an active DMS document', async () => {
    vi.mocked(doclingApi.searchDocuments).mockResolvedValue([
      {
        id: 99,
        filename: 'permanently-deleted.pptx',
        content: 'Customer support content from an orphaned OCR row.',
      },
    ]);
    vi.mocked(apiClient.getDocuments).mockResolvedValue({ success: true, data: [] });

    renderSearch('/search?q=customer');

    expect(await screen.findByText(/No parsed documents found/)).toBeInTheDocument();
    expect(screen.queryByText('permanently-deleted.pptx')).not.toBeInTheDocument();
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
