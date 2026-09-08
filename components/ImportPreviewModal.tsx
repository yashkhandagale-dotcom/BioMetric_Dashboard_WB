'use client';
import { useState, useEffect, useCallback } from 'react';
import { Calendar, Users, FileText, AlertTriangle, CheckCircle2, X, RefreshCw, PlusCircle, Loader2 } from 'lucide-react';
import { CSVDateRangeAnalysis, analyzeCSVDateRange } from '@/lib/parseCSV';

type DateFmt = 'DMY' | 'MDY' | 'YMD';

interface ImportPreviewModalProps {
  analysis: CSVDateRangeAnalysis;
  officeCode: string;
  existingRange: { minDate: string; maxDate: string } | null;
  defaultDateFormat: DateFmt;
  // For live re-analysis when user changes date format
  file?: File;
  dateColumn?: string;
  employeeColumn?: string;
  onAnalysisUpdate?: (analysis: CSVDateRangeAnalysis, fmt: DateFmt) => void;
  // Actions
  onOverwrite: (fmt: DateFmt) => void;
  onImportNewOnly: (fmt: DateFmt) => void;
  onImportAll: (fmt: DateFmt) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const DATE_FORMAT_OPTIONS: { value: DateFmt; label: string; example: string }[] = [
  { value: 'DMY', label: 'DD/MM/YYYY', example: '01/07/2026' },
  { value: 'MDY', label: 'MM/DD/YYYY', example: '07/01/2026' },
  { value: 'YMD', label: 'YYYY-MM-DD', example: '2026-07-01' },
];

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10)]} ${y}`;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function hasOverlap(newStart: string, newEnd: string, exStart: string, exEnd: string): boolean {
  return newStart <= exEnd && newEnd >= exStart;
}

function newOnlyRange(newStart: string, newEnd: string, exStart: string, exEnd: string): string {
  const parts: string[] = [];
  if (newStart < exStart) parts.push(`${fmtDate(newStart)} – ${fmtDate(exStart)}`);
  if (newEnd > exEnd) parts.push(`${fmtDate(exEnd)} – ${fmtDate(newEnd)}`);
  return parts.length > 0 ? parts.join(' and ') : 'No completely new dates outside existing range';
}

export default function ImportPreviewModal({
  analysis,
  officeCode,
  existingRange,
  defaultDateFormat,
  file,
  dateColumn,
  employeeColumn,
  onAnalysisUpdate,
  onOverwrite,
  onImportNewOnly,
  onImportAll,
  onCancel,
  isLoading = false,
}: ImportPreviewModalProps) {
  const [selectedFmt, setSelectedFmt] = useState<DateFmt>(defaultDateFormat);
  const [reanalyzing, setReanalyzing] = useState(false);

  // Re-analyze CSV when the user changes the date format
  const reanalyze = useCallback(async (fmt: DateFmt) => {
    if (!file || !dateColumn || !employeeColumn || !onAnalysisUpdate) return;
    setReanalyzing(true);
    try {
      const newAnalysis = await analyzeCSVDateRange(file, dateColumn, employeeColumn, fmt, true);
      onAnalysisUpdate(newAnalysis, fmt);
    } catch (err) {
      console.warn('[ImportPreviewModal] re-analysis failed:', err);
    } finally {
      setReanalyzing(false);
    }
  }, [file, dateColumn, employeeColumn, onAnalysisUpdate]);

  // Sync state if defaultDateFormat changes
  useEffect(() => {
    setSelectedFmt(defaultDateFormat);
  }, [defaultDateFormat]);

  // When selectedFmt changes (user clicks a format button), re-analyze
  useEffect(() => {
    if (selectedFmt !== defaultDateFormat) {
      reanalyze(selectedFmt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFmt]);

  const overlap = existingRange
    ? hasOverlap(analysis.startDate, analysis.endDate, existingRange.minDate, existingRange.maxDate)
    : false;

  const totalDays = daysBetween(analysis.startDate, analysis.endDate);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">

        {/* ── Header ── */}
        <div className="px-6 py-5 border-b border-[var(--border)] bg-[var(--bg-elevated)]/40">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-[var(--text-primary)] font-bold text-base leading-tight">
                  Import Attendance Data
                </h2>
                <p className="text-[var(--text-muted)] text-xs mt-0.5">
                  Step 1: Choose your date format. Step 2: Confirm the detected period.
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Step 1: Date Format Selector ── */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold">1</span>
            <p className="text-[var(--text-primary)] text-sm font-semibold">
              What date format does your CSV use?
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DATE_FORMAT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={isLoading || reanalyzing}
                onClick={() => setSelectedFmt(opt.value)}
                className={`flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                  selectedFmt === opt.value
                    ? 'bg-blue-600/15 border-blue-500/50 text-blue-400 ring-1 ring-blue-500/30'
                    : 'bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-muted)] hover:border-blue-500/30'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-mono font-semibold text-xs">{opt.label}</span>
                  {analysis.detectedDateFormat === opt.value && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1 py-0.5 rounded">
                      Auto
                    </span>
                  )}
                </div>
                <span className="font-mono text-[10px] opacity-60">{opt.example}</span>
              </button>
            ))}
          </div>
          <p className="text-[var(--text-muted)] text-[11px] mt-2">
            ⚠ The preview below updates live when you switch formats. Pick the one that matches your CSV.
          </p>
        </div>

        {/* ── Step 2: Detected Period Banner ── */}
        <div className="px-6 pt-3 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold">2</span>
            <p className="text-[var(--text-primary)] text-sm font-semibold">
              Confirm detected period
            </p>
            {reanalyzing && (
              <span className="flex items-center gap-1.5 text-blue-400 text-xs">
                <Loader2 className="w-3 h-3 animate-spin" /> Re-analyzing…
              </span>
            )}
          </div>

          <div className={`bg-blue-500/8 border border-blue-500/20 rounded-xl px-4 py-3.5 transition-opacity ${reanalyzing ? 'opacity-50' : ''}`}>
            <p className="text-blue-400 text-[11px] font-semibold uppercase tracking-widest mb-1">Detected Period</p>
            <p className="text-[var(--text-primary)] font-bold text-lg leading-tight">
              {fmtDate(analysis.startDate)}&nbsp;&ndash;&nbsp;{fmtDate(analysis.endDate)}
            </p>
            <div className="flex items-center gap-4 mt-2.5 flex-wrap">
              <span className="flex items-center gap-1.5 text-[var(--text-muted)] text-xs">
                <Calendar className="w-3.5 h-3.5" />{totalDays} day{totalDays !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1.5 text-[var(--text-muted)] text-xs">
                <FileText className="w-3.5 h-3.5" />{analysis.totalRecords.toLocaleString()} records
              </span>
              <span className="flex items-center gap-1.5 text-[var(--text-muted)] text-xs">
                <Users className="w-3.5 h-3.5" />{analysis.uniqueEmployees} employee{analysis.uniqueEmployees !== 1 ? 's' : ''}
              </span>
            </div>

            {analysis.monthsSpanned.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {analysis.monthsSpanned.map((m) => (
                  <span
                    key={`${m.year}-${m.month}`}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/20"
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            )}

            <p className="text-[var(--text-muted)] text-[11px] mt-2.5">
              Office: <span className="text-[var(--text-primary)] font-semibold">{officeCode}</span>
            </p>
          </div>

          {/* Overlap Warning */}
          {overlap && existingRange && (
            <div className="mt-3 bg-amber-500/8 border border-amber-500/25 rounded-xl px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-amber-400 font-semibold text-sm">Overlap Detected</p>
                  <p className="text-[var(--text-muted)] text-xs mt-1 leading-relaxed">
                    Existing data:&nbsp;
                    <span className="text-[var(--text-primary)] font-medium">{fmtDate(existingRange.minDate)}</span>
                    &nbsp;to&nbsp;
                    <span className="text-[var(--text-primary)] font-medium">{fmtDate(existingRange.maxDate)}</span>
                    &nbsp;({officeCode})
                  </p>
                  <p className="text-[var(--text-muted)] text-[11px] mt-2">
                    <span className="text-emerald-400 font-medium">New dates only: </span>
                    {newOnlyRange(analysis.startDate, analysis.endDate, existingRange.minDate, existingRange.maxDate)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {!overlap && existingRange && (
            <div className="mt-3 bg-emerald-500/8 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-[var(--text-muted)] text-xs">
                No overlap — this covers a completely new date range.
              </p>
            </div>
          )}
        </div>

        {/* ── Action Buttons ── */}
        <div className="px-6 pb-5 space-y-2">
          {overlap ? (
            <>
              <button
                onClick={() => onOverwrite(selectedFmt)}
                disabled={isLoading || reanalyzing}
                className="w-full flex items-center gap-2.5 px-5 py-3 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-400 text-white transition-colors disabled:opacity-50"
              >
                <RefreshCw className="w-4 h-4" />
                Overwrite Overlapping Period
                <span className="ml-auto text-[11px] font-normal opacity-80">Updates existing + adds new</span>
              </button>
              <button
                onClick={() => onImportNewOnly(selectedFmt)}
                disabled={isLoading || reanalyzing}
                className="w-full flex items-center gap-2.5 px-5 py-3 rounded-xl font-semibold text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/70 transition-colors disabled:opacity-50"
              >
                <PlusCircle className="w-4 h-4 text-emerald-400" />
                Keep Existing — Import New Dates Only
                <span className="ml-auto text-[11px] font-normal text-[var(--text-muted)]">Leaves overlapping dates untouched</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => onImportAll(selectedFmt)}
              disabled={isLoading || reanalyzing}
              className="w-full flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl font-semibold text-sm bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isLoading ? 'Importing…' : 'Import Now'}
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="w-full px-5 py-2.5 rounded-xl text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
