import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModalOverlay } from './ModalOverlay';

function ModalHarness({ onOuterClose, onInnerClose }: { onOuterClose: () => void; onInnerClose: () => void }) {
  const [innerOpen, setInnerOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(true);
  return (
    <ModalOverlay onClose={onOuterClose} role="dialog" aria-label="Outer dialog">
      <div>
        Outer
        {innerOpen && (
          <ModalOverlay onClose={() => { setInnerOpen(false); onInnerClose(); }} role="dialog" aria-label="Inner dialog">
            <button type="button">Inside inner</button>
            {menuOpen && <button type="button" role="menu" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); } }}>Open menu</button>}
          </ModalOverlay>
        )}
      </div>
    </ModalOverlay>
  );
}

describe('ModalOverlay', () => {
  it('ignores backdrop clicks and only closes the top-most modal on Escape', async () => {
    const user = userEvent.setup();
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    render(<ModalHarness onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);

    await user.click(screen.getByRole('dialog', { name: 'Inner dialog' }));
    expect(onInnerClose).not.toHaveBeenCalled();
    expect(onOuterClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('menu'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onInnerClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onInnerClose).toHaveBeenCalledOnce();
    expect(onOuterClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onOuterClose).toHaveBeenCalledOnce();
  });
});
