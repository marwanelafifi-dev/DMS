import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../utils/api';
import { TagSelector } from './TagSelector';

function Harness() {
  const [tags, setTags] = useState(['Existing custom']);
  return <><TagSelector value={tags} onChange={setTags} /><output>{tags.join('|')}</output></>;
}

describe('TagSelector', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getDropdownList').mockResolvedValue({
      success: true,
      data: [{ label: 'Quality' }, { label: 'Review' }],
    });
  });

  it('uses configured tags while preserving add/remove support for existing custom tags', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Add tag Quality' }));
    expect(screen.getByText('Existing custom|Quality')).toBeInTheDocument();

    const custom = screen.getByRole('textbox', { name: 'Add custom tag' });
    await user.type(custom, 'Audit{Enter}');
    expect(screen.getByText('Existing custom|Quality|Audit')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove tag Existing custom' }));
    expect(screen.getByText('Quality|Audit')).toBeInTheDocument();
  });
});
