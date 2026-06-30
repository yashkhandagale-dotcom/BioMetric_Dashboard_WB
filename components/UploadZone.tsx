'use client';
import { useRef, useState, DragEvent } from 'react';
import { Upload, FileX } from 'lucide-react';
import { validateFile } from '@/lib/validateFile';

interface UploadZoneProps {
  // B2: receives every dropped/selected file at once; the parent decides how
  // to sequence validation, mapping prompts, and merging.
  onFiles: (files: File[]) => void;
}

export default function UploadZone({ onFiles }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(files: FileList | File[]) {
    setError(null);
    const list = Array.from(files);
    if (list.length === 0) return;
    // Quick client-side sanity check so the user gets instant feedback for an
    // obviously-wrong single file; full per-file validation happens upstream
    // (B2: invalid files in a batch are skipped individually, not blocked here).
    if (list.length === 1) {
      const result = validateFile(list[0]);
      if (!result.valid) {
        setError(result.error || 'Invalid file');
        return;
      }
    }
    onFiles(list);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Attendance Dashboard</h1>
          <p className="text-slate-400 text-sm">Upload one or more biometric export CSVs to get started</p>
        </div>

        <div
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
          className={`
            relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200
            ${dragging
              ? 'border-blue-400 bg-blue-500/10 scale-[1.02]'
              : 'border-slate-600 bg-slate-800/50 hover:border-slate-400 hover:bg-slate-800'}
          `}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <Upload className={`w-12 h-12 mx-auto mb-4 transition-colors ${dragging ? 'text-blue-400' : 'text-slate-500'}`} />

          <p className="text-white font-medium text-lg mb-1">
            {dragging ? 'Drop your CSV file(s) here' : 'Drag & drop CSV file(s)'}
          </p>
          <p className="text-slate-400 text-sm mb-4">or click to browse — multiple files supported</p>

          <div className="inline-flex items-center gap-2 bg-slate-700/60 px-4 py-2 rounded-lg text-xs text-slate-400">
            <span className="font-mono">YYYY_MM_OFFICECODE.csv</span>
            <span>·</span>
            <span>Max 5 MB each</span>
          </div>

          <p className="text-slate-500 text-xs mt-3">Example: 2026_05_MUM.csv</p>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex gap-3">
            <FileX className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 font-medium text-sm mb-1">Upload failed</p>
              <pre className="text-red-300/80 text-xs whitespace-pre-wrap font-sans">{error}</pre>
            </div>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-slate-600">
          <p>Data is stored locally in your browser — nothing leaves this machine</p>
        </div>
      </div>
    </div>
  );
}
