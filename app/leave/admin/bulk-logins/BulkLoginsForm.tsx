'use client';

import { useState } from 'react';

type RowResult = {
  employee_code: string;
  email: string;
  status: 'created' | 'already_linked' | 'not_found' | 'invalid_email' | 'weak_password' | 'error';
  detail?: string;
};

const STATUS_STYLE: Record<RowResult['status'], string> = {
  created: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  already_linked: 'bg-[var(--accent)]/20 text-[var(--accent)] dark:text-[var(--accent)]',
  not_found: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  invalid_email: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  weak_password: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  error: 'bg-red-500/20 text-red-700 dark:text-red-300',
};

// Minimal CSV line parser — handles quoted fields (so a quoted full_name
// containing a comma doesn't split wrong) and "" as an escaped quote
// inside a quoted field. Good enough for this one-off admin tool; not
// meant to be a general CSV library.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

// Expected header: employee_code,full_name,login_email,password,status
// (status column, if present, is ignored here — it's from whatever
// generated the source spreadsheet, not something this tool reads).
function parseCsv(text: string): { rows: { employee_code: string; email: string; password: string }[]; error: string | null } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], error: 'Paste the header row plus at least one data row.' };

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const codeIdx = header.indexOf('employee_code');
  const emailIdx = header.findIndex((h) => h === 'login_email' || h === 'email');
  const passIdx = header.findIndex((h) => h === 'password');

  if (codeIdx === -1 || emailIdx === -1 || passIdx === -1) {
    return {
      rows: [],
      error: 'Header must include employee_code, login_email (or email), and password columns.',
    };
  }

  const rows = lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    return { employee_code: (f[codeIdx] ?? '').trim(), email: (f[emailIdx] ?? '').trim(), password: f[passIdx] ?? '' };
  });

  return { rows, error: null };
}

export default function BulkLoginsForm() {
  const [csvText, setCsvText] = useState('');
  const [parsedCount, setParsedCount] = useState<number | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [summary, setSummary] = useState<{ created: number; already_linked: number; failed: number } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handlePreview(text: string) {
    setCsvText(text);
    setResults(null);
    setSummary(null);
    setSubmitError(null);
    if (!text.trim()) {
      setParsedCount(null);
      setParseError(null);
      return;
    }
    const { rows, error } = parseCsv(text);
    setParseError(error);
    setParsedCount(error ? null : rows.length);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    handlePreview(text);
  }

  async function handleSubmit() {
    const { rows, error } = parseCsv(csvText);
    if (error) {
      setSubmitError(error);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setResults(null);
    setSummary(null);
    try {
      const res = await fetch('/api/leave/admin/employees/bulk-create-logins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setSubmitting(false);
      if (!res.ok) {
        setSubmitError(data.error || `Failed (${res.status}).`);
        return;
      }
      setSummary(data.summary);
      setResults(data.results);
    } catch {
      setSubmitting(false);
      setSubmitError('Could not reach the server — check your connection and try again.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs text-[var(--text-muted)]">CSV (employee_code, login_email, password)</label>
          <label className="text-xs text-[var(--accent)] hover:text-[var(--accent)]/90 cursor-pointer">
            Upload file…
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </label>
        </div>
        <textarea
          value={csvText}
          onChange={(e) => handlePreview(e.target.value)}
          placeholder={'employee_code,full_name,login_email,password,status\n1,"Anirudha Choudhari",anirudha.choudhari@wonderbiz.in,Anirudha@123,OK'}
          rows={10}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)]"
        />
        {parseError && <p className="text-amber-600 dark:text-amber-400 text-xs">{parseError}</p>}
        {parsedCount !== null && !parseError && (
          <p className="text-[var(--text-muted)] text-xs">{parsedCount} row{parsedCount === 1 ? '' : 's'} parsed.</p>
        )}
        {submitError && (
          <div className="bg-red-900/30 border border-red-500/30 text-red-700 dark:text-red-300 text-xs rounded-lg px-3 py-2">
            {submitError}
          </div>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !parsedCount}
          className="w-full bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          {submitting ? `Creating logins for ${parsedCount ?? 0} rows…` : `Create Logins${parsedCount ? ` (${parsedCount})` : ''}`}
        </button>
      </div>

      {summary && (
        <div className="flex gap-3 text-xs">
          <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-lg px-3 py-1.5">
            {summary.created} created
          </span>
          <span className="bg-[var(--accent)]/20 text-[var(--accent)] dark:text-[var(--accent)] rounded-lg px-3 py-1.5">
            {summary.already_linked} already linked
          </span>
          <span className="bg-red-500/20 text-red-700 dark:text-red-300 rounded-lg px-3 py-1.5">
            {summary.failed} need attention
          </span>
        </div>
      )}

      {results && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.employee_code}-${i}`} className="border-b border-[var(--border)]/50 last:border-0">
                  <td className="py-1.5 pr-4">{r.employee_code}</td>
                  <td className="py-1.5 pr-4">{r.email}</td>
                  <td className="py-1.5 pr-4">
                    <span className={`px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>{r.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="py-1.5 text-[var(--text-muted)]">{r.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
