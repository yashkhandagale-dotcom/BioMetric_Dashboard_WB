'use client';
import { useRef, useState } from 'react';
import { Download, Upload, AlertTriangle, CheckCircle } from 'lucide-react';
import { exportAllData, importAllData, BackupFile } from '@/lib/storage';

export default function BackupPanel({ onRestored }: { onRestored?: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  function handleExport() {
    const backup = exportAllData();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `attendance-dashboard-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus({ type: 'success', message: 'Backup downloaded.' });
  }

  function handleImportClick() {
    setConfirming(true);
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as BackupFile;
        const { imported } = importAllData(parsed);
        setStatus({ type: 'success', message: `Restored ${imported} item${imported === 1 ? '' : 's'}. Reload the page to see the restored data.` });
        onRestored?.();
      } catch {
        setStatus({ type: 'error', message: 'Could not read that file — is it a valid backup JSON?' });
      }
    };
    reader.onerror = () => setStatus({ type: 'error', message: 'Could not read that file.' });
    reader.readAsText(file);
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">Backup All Data</h4>
        <p className="text-slate-500 text-xs mb-3">
          Download every record, column mapping, leave entry, holiday calendar, and threshold setting as a single JSON file.
        </p>
        <button
          onClick={handleExport}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" /> Export All Data
        </button>
      </div>

      <div>
        <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">Restore From Backup</h4>
        <p className="text-slate-500 text-xs mb-3">
          Restoring merges the backup into what&apos;s already stored here — matching keys are overwritten.
        </p>

        {!confirming ? (
          <button
            onClick={handleImportClick}
            className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Upload className="w-4 h-4" /> Import All Data
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>This will overwrite any current data with matching keys. Continue?</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirming(false); fileInputRef.current?.click(); }}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              >
                Choose File…
              </button>
            </div>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFileChosen} />
      </div>

      {status && (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs border ${
          status.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
            : 'bg-red-500/10 border-red-500/20 text-red-300'
        }`}>
          {status.type === 'success' ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
}
