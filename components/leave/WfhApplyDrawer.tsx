'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import WfhApplyForm, { WfhSubmitResult, WfhApplyInitialValues } from './WfhApplyForm';

// Mirrors ApplyLeaveDrawer.tsx's slide-over pattern exactly (same
// mount/close/Escape/auto-close-after-success behavior), wrapping
// WfhApplyForm instead of ApplyLeaveForm — so "Apply for Leave" and
// "Apply for WFH" (both now launched from LeaveShell's sidebar) open
// the same kind of popup.
export default function WfhApplyDrawer({
  onClose,
  onSuccess,
  initialValues,
}: {
  onClose: () => void;
  onSuccess: (result: WfhSubmitResult) => void;
  initialValues?: WfhApplyInitialValues;
}) {
  const [mounted, setMounted] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

  function handleFormSuccess(result: WfhSubmitResult) {
    setSubmitted(true);
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
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h3 className="text-[var(--text-primary)] font-semibold text-base">Apply for WFH</h3>
            <p className="text-[var(--text-muted)] text-xs mt-0.5">Submit a work from home request for manager approval</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-6 sm:p-7">
          {submitted ? (
            <div className="bg-emerald-900/30 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs rounded-lg px-3 py-2">
              Submitted — sent for manager approval.
            </div>
          ) : (
            <WfhApplyForm onSuccess={handleFormSuccess} initialValues={initialValues} />
          )}
        </div>
      </div>
    </div>
  );
}
