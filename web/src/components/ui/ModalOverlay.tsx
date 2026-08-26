import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';

const openModalStack: Array<{ id: symbol; element: HTMLDivElement }> = [];

interface ModalOverlayProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  children: ReactNode;
  onClose: () => void;
}

/** Shared behavior for true application dialogs; backdrop clicks are inert. */
export function ModalOverlay({ children, onClose, className = '', ...props }: ModalOverlayProps) {
  const modalId = useRef(Symbol('modal'));
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = modalId.current;
    const element = overlayRef.current;
    if (!element) return;
    openModalStack.push({ id, element });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const topMost = openModalStack.filter((candidate) =>
        !openModalStack.some((other) => other.id !== candidate.id && candidate.element.contains(other.element)),
      ).at(-1);
      if (topMost?.id !== id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const index = openModalStack.findIndex((entry) => entry.id === id);
      if (index >= 0) openModalStack.splice(index, 1);
    };
  }, []);

  return <div ref={overlayRef} className={className} data-modal-overlay="true" {...props}>{children}</div>;
}

/** Prevents Radix Dialog from treating outside interaction as dismissal. */
export function preventModalOutsideDismiss(event: Event) {
  event.preventDefault();
}
