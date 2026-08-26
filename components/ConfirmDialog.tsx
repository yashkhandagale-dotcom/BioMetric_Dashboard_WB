'use client';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  items?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, message, items, confirmLabel = 'Overwrite', cancelLabel = 'Cancel', onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-[var(--text-primary)] font-semibold text-sm">{title}</h3>
            <p className="text-[var(--text-muted)] text-xs mt-1">{message}</p>
          </div>
        </div>
        {items && items.length > 0 && (
          <div className="scroll-thin px-5 py-3 max-h-48 overflow-y-auto">
            <ul className="space-y-1">
              {items.map((it, i) => (
                <li key={i} className="text-[var(--text-muted)] text-xs bg-[var(--bg-elevated)]/60 rounded-lg px-3 py-1.5">{it}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="px-5 py-4 flex justify-end gap-2 border-t border-[var(--border)]">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-muted)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
