import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Folder } from '../../types';
import { FolderTree } from './FolderTree';

const base = { ownerId: 'owner', createdAt: '2026-01-01', updatedAt: '2026-01-01', isArchived: false };
const folders: Folder[] = [
  { ...base, folderId: 'root', name: 'Root' },
  { ...base, folderId: 'child', parentFolderId: 'root', name: 'Child' },
  { ...base, folderId: 'grandchild', parentFolderId: 'child', name: 'Grandchild' },
];

describe('FolderTree', () => {
  it('starts collapsed and supports expanding or collapsing the complete hierarchy', async () => {
    const user = userEvent.setup();
    render(<FolderTree folders={folders} onSelectFolder={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Child' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Root' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand all folders' }));
    expect(screen.getByRole('button', { name: 'Grandchild' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse all folders' }));
    expect(screen.queryByRole('button', { name: 'Child' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand all folders' }));

    await user.click(screen.getByRole('button', { name: 'Collapse Child' }));
    expect(screen.queryByRole('button', { name: 'Grandchild' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Child' })).toBeInTheDocument();
  });
});
