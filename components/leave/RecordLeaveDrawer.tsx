'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import RecordLeaveForm, { SubmitResult } from './RecordLeaveForm';

// D2-3: Record Leave is now a slide-over drawer instead of a standalone
// page, so HR never has to leave the employee grid (or the modal) to
// record a leave. Opens pinned to the right edge, closes on backdrop
// click, Escape, or automatically a couple seconds after a successful
// save — long enough to read any policy notes / LWP-conversion message.
export default function RecordLeaveDrawer({
  employeeId,
  employeeName,
  onClose,
  onSuccess,
}: {
  employeeId: string;
  employeeName?: string;
  onClose: () => void;
  onSuccess: () => void;
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

  function handleFormSuccess(_result: SubmitResult) {
    // Balances refresh right away (parent re-fetches server data); the
    // drawer itself stays open a moment longer so HR can read the
    // confirmation/policy notes RecordLeaveForm renders inline, then
    // auto-closes — matching "drawer opens, fills, saves, closes,
    // balances refresh in place" from the Day 2 acceptance criteria.
    onSuccess();
    setTimeout(onClose, 1800);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`h-full w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          mounted ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <div>
            <h3 className="text-white font-semibold text-sm">Record Leave</h3>
            {employeeName && <p className="text-slate-500 text-xs mt-0.5">{employeeName}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <RecordLeaveForm presetEmployeeId={employeeId} onSuccess={handleFormSuccess} />
        </div>
      </div>
    </div>
  );
}
