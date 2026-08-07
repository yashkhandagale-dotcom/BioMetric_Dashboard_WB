'use client';
import { useEffect } from 'react';

// Phase 13 (Modals & Dialogs) — every overlay in the app opens its own
// bespoke <div className="fixed inset-0 ..."> rather than sharing a base
// component, so ESC-to-close and background-scroll-lock were implemented
// inconsistently (some had it, most didn't). Rather than a risky rewrite
// into a single shared <Modal> wrapper, this hook adds the two behaviors
// every one of them was missing, without touching each component's markup
// or props. Call it with the same close handler already passed to the
// component, and `active` = whatever condition currently guards rendering
// the overlay (e.g. a boolean state or a non-null selection).
export function useModalA11y(onClose: () => void, active: boolean = true) {
  useEffect(() => {
    if (!active) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
