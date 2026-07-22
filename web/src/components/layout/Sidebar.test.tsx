import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('does not show Preview Canvas in navigation', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Sidebar isExpanded />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /preview canvas/i })).not.toBeInTheDocument();
  });
});
