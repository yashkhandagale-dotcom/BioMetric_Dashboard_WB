'use client';
import { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, FileIcon, ChevronDown, Loader2 } from 'lucide-react';
import { AttendanceRecord, EmployeeSummary, LeaveRecord } from '@/lib/types';
import { exportExcel, exportCSV } from '@/lib/exportData';

interface ExportPanelProps {
  records: AttendanceRecord[];
  summaries: EmployeeSummary[];
  label: string;
  leaveRecords?: LeaveRecord[];
}

export default function ExportPanel({ records, summaries, label, leaveRecords = [] }: ExportPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<'excel' | 'csv' | 'pdf' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleExcel() {
    setLoading('excel');
    setOpen(false);
    await new Promise(r => setTimeout(r, 50));
    exportExcel(records, summaries, label, leaveRecords);
    setLoading(null);
  }

  async function handleCSV() {
    setLoading('csv');
    setOpen(false);
    await new Promise(r => setTimeout(r, 50));
    exportCSV(records, label, leaveRecords);
    setLoading(null);
  }

  async function handlePDF() {
    setLoading('pdf');
    setOpen(false);
    await new Promise(r => setTimeout(r, 50));
    const { exportPDF } = await import('@/lib/exportPDF');
    await exportPDF(records, summaries, label);
    setLoading(null);
  }

  const disabled = records.length === 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        Export
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50">
          <button
            onClick={handleExcel}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-slate-700 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <div className="text-left">
              <div className="font-medium">Download as Excel</div>
              <div className="text-xs text-slate-400">5 sheets · navy headers</div>
            </div>
          </button>
          <div className="border-t border-slate-700" />
          <button
            onClick={handleCSV}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-slate-700 transition-colors"
          >
            <FileText className="w-4 h-4 text-blue-400" />
            <div className="text-left">
              <div className="font-medium">Download as CSV</div>
              <div className="text-xs text-slate-400">UTF-8 BOM · raw records</div>
            </div>
          </button>
          <div className="border-t border-slate-700" />
          <button
            onClick={handlePDF}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-slate-700 transition-colors"
          >
            <FileIcon className="w-4 h-4 text-red-400" />
            <div className="text-left">
              <div className="font-medium">Download as PDF</div>
              <div className="text-xs text-slate-400">2-page visual summary</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
