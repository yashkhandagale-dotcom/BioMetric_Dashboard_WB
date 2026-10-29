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
        className={`h-full w-full sm:max-w-xl md:max-w-2xl bg-[var(--bg-surface)] border-l border-[var(--border)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          mounted ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-elevated)]/50 shrink-0">
          <div>
            <h3 className="text-[var(--text-primary)] font-bold text-base">Apply for Leave</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Submit a planned, casual, sick, or half-day leave request</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-6 sm:p-7">
          <ApplyLeaveForm onSuccess={handleFormSuccess} initialValues={initialValues} />
        </div>
      </div>
    </div>
  );
}