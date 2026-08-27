import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLibraryDocuments } from '../../fixtures/documentLibrary';
import { apiClient } from '../../utils/api';
import { DocumentList, defaultVisibleDocumentColumns } from './DocumentList';
import { DocumentPreview } from './DocumentPreview';
import { ColumnVisibilityMenu } from './LibraryMenus';

const migratedDocument = {
  ...mockLibraryDocuments[0],
  documentId: '4f4cdd06-0ce3-556a-8232-b199898d1941',
  category: 'Review',
};

describe('document Category visibility', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getLegacyMetadataHistory').mockResolvedValue({
      success: true,
      data: {
        hasLegacyMetadataHistory: false,
        legacyDocumentId: null,
        sourceSystem: null,
        snapshots: [],
      },
    });
  });

  it('shows Category prominently in the document details header without replacing Type', async () => {
    render(
      <DocumentPreview
        document={migratedDocument}
        onClose={vi.fn()}
        onDownload={vi.fn()}
        permissions={{
          viewOnly: true, downloadReadOnly: true,
          downloadForEditing: true, upload: true, updateFile: true,
          updateFolder: true, createSubfolder: true, createParentFolder: true,
          addTask: true, deleteParentFolder: true, deleteSubfolder: true,
          deleteFile: true, submitForApproval: true, approve: true, reject: true,
          adminForceUnlock: true, copy: true, cut: true, downloadZip: true,
          fileCopy: true, fileCut: true, edit: true, folderEdit: true, managePermissions: true,
          fileManagePermissions: true, viewHistory: true, viewRelatedTasks: true,
          viewMetadataHistory: true,
        }}
      />,
    );

    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText(migratedDocument.extension)).toHaveClass('uppercase');
  });

  it('includes Category in the configurable library columns', async () => {
    const user = userEvent.setup();
    const visible = new Set(defaultVisibleDocumentColumns);
    const onChange = vi.fn();
    const { rerender } = render(
      <>
        <ColumnVisibilityMenu visibleColumns={visible} onChange={onChange} />
        <DocumentList documents={[migratedDocument]} visibleColumns={visible} onDocumentClick={vi.fn()} />
      </>,
    );

    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Review' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Category' }));
    const nextVisible = onChange.mock.calls[0][0] as Set<string>;
    expect(nextVisible.has('category')).toBe(false);

    rerender(
      <>
        <ColumnVisibilityMenu visibleColumns={nextVisible as Set<any>} onChange={onChange} />
        <DocumentList documents={[migratedDocument]} visibleColumns={nextVisible as Set<any>} onDocumentClick={vi.fn()} />
      </>,
    );
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Category' })).not.toBeInTheDocument());
  });
});
