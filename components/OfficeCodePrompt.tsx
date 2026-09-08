'use client';
import { useState } from 'react';
import { Building2, ArrowRight, X } from 'lucide-react';

interface OfficeCodePromptProps {
  fileName: string;
  onConfirm: (officeCode: string) => void;
  onCancel: () => void;
}

const OFFICE_CODE_REGEX = /^[A-Z]{2,6}$/;

export default function OfficeCodePrompt({ fileName, onConfirm, onCancel }: OfficeCodePromptProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    const trimmed = code.trim().toUpperCase();
    if (!OFFICE_CODE_REGEX.test(trimmed)) {
      setError('Office code must be 2–6 uppercase letters (e.g. MUM, DEL, BLR).');
      return;
    }
    setError(null);
    onConfirm(trimmed);
  }

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
              <Building2 className="w-4.5 h-4.5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-[var(--text-primary)] font-semibold text-sm leading-tight">Which office is this data for?</h2>
              <p className="text-[var(--text-muted)] text-xs mt-0.5 truncate max-w-[220px]" title={fileName}>{fileName}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-[var(--text-muted)] text-sm mb-4">
            Your filename doesn&apos;t include an office code. Enter a short identifier so records are grouped correctly in the dashboard.
          </p>

          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
            Office Code
          </label>
          <input
            autoFocus
            type="text"
            maxLength={6}
            placeholder="e.g. MUM, DEL, BLR"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            className={`w-full bg-[var(--bg-elevated)] text-[var(--text-primary)] text-base font-mono tracking-widest rounded-xl px-4 py-3 border focus:outline-none focus:border-blue-500 transition-colors ${
              error ? 'border-red-500' : 'border-[var(--border)]'
            }`}
          />

          {error && (
            <p className="text-red-400 text-xs mt-2">{error}</p>
          )}

          <p className="text-[var(--text-muted)] text-[11px] mt-3">
            This will be saved and auto-used for future uploads of the same office.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-[var(--text-muted)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)]/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
