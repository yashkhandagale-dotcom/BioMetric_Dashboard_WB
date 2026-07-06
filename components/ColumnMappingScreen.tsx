'use client';
import { useState, useMemo } from 'react';
import { ArrowRight, Save, CheckCircle2 } from 'lucide-react';
import { ColumnMapping } from '@/lib/types';
import { REQUIRED_STANDARD_FIELDS, FIELD_LABELS } from '@/lib/validateFile';
import { autoMatchColumns } from '@/lib/columnMatch';

interface ColumnMappingScreenProps {
  officeCode: string;
  csvHeaders: string[];
  initialMapping?: Partial<ColumnMapping>; // A8: pre-fill when re-opened from Settings
  onSave: (mapping: ColumnMapping) => void;
  onCancel?: () => void;
}

export default function ColumnMappingScreen({ officeCode, csvHeaders, initialMapping, onSave, onCancel }: ColumnMappingScreenProps) {
  const auto = useMemo(() => autoMatchColumns(csvHeaders), [csvHeaders]);

  const [mapping, setMapping] = useState<Partial<ColumnMapping>>(() => ({
    ...auto.mapping,
    ...(initialMapping || {}),
  }));
  const [autoMatchedFields] = useState<Set<keyof ColumnMapping>>(
    () => new Set(initialMapping ? [] : auto.autoMatched) // only show the tag for a fresh auto-match, not a manual remap
  );
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const missing = REQUIRED_STANDARD_FIELDS.filter(f => !mapping[f]);
    if (missing.length > 0) {
      setTouched(new Set(missing));
      setError(`Please map: ${missing.map(f => FIELD_LABELS[f]).join(', ')}`);
      return;
    }
    onSave(mapping as ColumnMapping);
  }

  const extraCols = auto.unmatchedHeaders;

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
      <div className="w-full max-w-2xl">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full text-blue-400 text-xs font-medium mb-3">
            {initialMapping ? `Remapping ${officeCode}` : `First upload for ${officeCode}`}
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">Map your columns</h2>
          <p className="text-slate-400 text-sm">
            We've pre-matched what we could recognize — review and adjust, then save. This is a one-time setup per office; re-uploads skip this screen.
          </p>
        </div>

        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="grid grid-cols-2 gap-0 text-xs font-medium text-slate-400 uppercase tracking-wide px-4 sm:px-6 py-3 border-b border-slate-700 bg-slate-800/80">
            <span>Standard Field</span>
            <span>Your CSV Column</span>
          </div>

          <div className="divide-y divide-slate-700/50">
            {REQUIRED_STANDARD_FIELDS.map((field) => {
              const isMissing = touched.has(field) && !mapping[field];
              return (
                <div key={field} className="grid grid-cols-2 items-center gap-2 sm:gap-4 px-4 sm:px-6 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">{FIELD_LABELS[field]}</span>
                    <span className="text-red-400 text-xs">*</span>
                    {autoMatchedFields.has(field) && mapping[field] && (
                      <span className="flex items-center gap-1 text-emerald-400 text-[10px] font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Auto-matched
                      </span>
                    )}
                  </div>
                  <div>
                    <select
                      value={(mapping as Record<string, string>)[field] || ''}
                      onChange={(e) => {
                        setError(null);
                        autoMatchedFields.delete(field);
                        setMapping(prev => ({ ...prev, [field]: e.target.value }));
                      }}
                      className={`bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border w-full focus:outline-none focus:border-blue-500 ${isMissing ? 'border-red-500' : 'border-slate-600'}`}
                    >
                      <option value="">— Select column —</option>
                      {csvHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    {isMissing && (
                      <p className="text-red-400 text-[11px] mt-1">Required — no matching column found automatically.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {extraCols.length > 0 && (
          <div className="mt-3 p-3 bg-slate-800/60 border border-slate-700 rounded-xl text-xs text-slate-400">
            {extraCols.length} additional column{extraCols.length > 1 ? 's' : ''} detected and will be preserved but not used in calculations: {extraCols.join(', ')}
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-5 py-3 rounded-xl font-medium text-sm text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            Save & Import
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
