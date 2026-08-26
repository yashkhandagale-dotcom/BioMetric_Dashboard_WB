'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import ApplyLeaveForm, { ApplySubmitResult, ApplyLeaveInitialValues } from './ApplyLeaveForm';

// A5 — matches RecordLeaveDrawer.tsx's slide-over pattern exactly
// (same mount/close/Escape/auto-close-after-success behavior), wrapping
// ApplyLeaveForm instead of RecordLeaveForm.
export default function ApplyLeaveDrawer({
  onClose,
  onSuccess,
  initialValues,
}: {
  onClose: () => void;
  onSuccess: (result: ApplySubmitResult) => void;
  initialValues?: ApplyLeaveInitialValues;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleFormSuccess(result: ApplySubmitResult) {
    onSuccess(result);
    setTimeout(onClose, 1800);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`h-full w-full max-w-md bg-[var(--bg-surface)] border-l border-[var(--border)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          mounted ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <h3 className="text-[var(--text-primary)] font-semibold text-sm">Apply for Leave</h3>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-5">
          <ApplyLeaveForm onSuccess={handleFormSuccess} initialValues={initialValues} />
        </div>
      </div>
    </div>
  );
}