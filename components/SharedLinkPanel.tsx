'use client';
import { useState } from 'react';
import { Link2, Copy, RefreshCw, CheckCheck, AlertTriangle } from 'lucide-react';
import { AttendanceRecord } from '@/lib/types';
import { createSharedLink } from '@/lib/sharedLink';

interface SharedLinkPanelProps {
  records: AttendanceRecord[];
}

const MAX_SAFE_RECORDS = 3000;

export default function SharedLinkPanel({ records }: SharedLinkPanelProps) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooLarge = records.length > MAX_SAFE_RECORDS;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const url = await createSharedLink(records);
      setLink(url);
      setCopied(false);
    } catch {
      setError('Could not generate link — please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Link2 className="w-4 h-4 text-blue-400" />
        <h3 className="text-white font-semibold text-sm">Share with Manager</h3>
      </div>

      <p className="text-slate-400 text-xs mb-3">
        Generates a read-only link — manager sees the same dashboard, no upload option.
        The data itself stays on this server (not embedded in the link) and the link expires after 24 hours.
        Works on any device on the same WiFi.
      </p>

      {tooLarge && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{records.length.toLocaleString()} records is large — link will work but may be slow to open on mobile.</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!link ? (
        <button
          onClick={generate}
          disabled={records.length === 0 || loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? 'Generating…' : 'Generate Shared Link'}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="bg-slate-900 rounded-lg px-3 py-2 text-xs font-mono text-blue-300 break-all border border-slate-700 max-h-20 overflow-y-auto">
            {link}
          </div>
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            >
              {copied ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <button
              onClick={generate}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              {loading ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
          <p className="text-slate-600 text-xs">Link expires in 24 hours. Only a random token is in the URL — the data itself lives on the server, not in the link.</p>
        </div>
      )}

      {/* Vercel deploy note */}
      <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-3 text-xs text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>
          ⚠️ This link only works while the HR machine is running the server. For permanent access from any network, deploy to Vercel first. See README for instructions.
        </span>
      </div>
    </div>
  );
}
