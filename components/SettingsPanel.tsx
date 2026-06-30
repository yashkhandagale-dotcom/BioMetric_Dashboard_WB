'use client';
import { useState } from 'react';
import { X, Settings as SettingsIcon, RotateCcw, Calendar } from 'lucide-react';
import { ColumnMapping, Thresholds, AttendanceRecord, Holiday } from '@/lib/types';
import { getAllMappings } from '@/lib/storage';
import { DEFAULT_THRESHOLDS } from '@/lib/settings';
import SharedLinkPanel from './SharedLinkPanel';
import HolidayModal from './HolidayModal';

interface SettingsPanelProps {
  onClose: () => void;
  thresholds: Thresholds;
  onSaveThresholds: (t: Thresholds) => void;
  records: AttendanceRecord[];
  officeCode?: string;
  year?: string;
  holidays?: Holiday[];
  onHolidaysSaved?: (h: Holiday[]) => void;
}

const THRESHOLD_FIELDS: { key: keyof Thresholds; label: string; group: string }[] = [
  { key: 'attendanceRateGreen', label: 'Attendance Rate — Green ≥', group: 'Attendance Rate (%)' },
  { key: 'attendanceRateAmber', label: 'Attendance Rate — Amber ≥', group: 'Attendance Rate (%)' },
  { key: 'absenteeismRateGreen', label: 'Absenteeism Rate — Green <', group: 'Absenteeism Rate (%)' },
  { key: 'absenteeismRateAmber', label: 'Absenteeism Rate — Amber <', group: 'Absenteeism Rate (%)' },
  { key: 'avgHoursPctGreen', label: 'Avg Hours % — Green ≥', group: 'Avg Hours (% of 8h)' },
  { key: 'avgHoursPctAmber', label: 'Avg Hours % — Amber ≥', group: 'Avg Hours (% of 8h)' },
  { key: 'lateRateGreen', label: 'Late Arrival Rate — Green <', group: 'Late Arrival Rate (%)' },
  { key: 'lateRateAmber', label: 'Late Arrival Rate — Amber <', group: 'Late Arrival Rate (%)' },
  { key: 'earlyRateGreen', label: 'Early Exit Rate — Green <', group: 'Early Exit Rate (%)' },
  { key: 'earlyRateAmber', label: 'Early Exit Rate — Amber <', group: 'Early Exit Rate (%)' },
  { key: 'productivityLostGreen', label: 'Productivity Lost — Green <', group: 'Productivity Lost (%)' },
  { key: 'productivityLostAmber', label: 'Productivity Lost — Amber <', group: 'Productivity Lost (%)' },
  { key: 'shortDayMinutes', label: 'Short Day threshold (minutes)', group: 'Other Thresholds' },
  { key: 'frequentPunchCount', label: 'Frequent Punch count threshold', group: 'Other Thresholds' },
  { key: 'graceMinutes', label: 'Grace Period (minutes)', group: 'Other Thresholds' },
];

export default function SettingsPanel({ onClose, thresholds, onSaveThresholds, records, officeCode, year, holidays = [], onHolidaysSaved }: SettingsPanelProps) {
  const [tab, setTab] = useState<'mapping' | 'thresholds' | 'share' | 'holidays'>('thresholds');
  const [draft, setDraft] = useState<Thresholds>(thresholds);
  const [dirty, setDirty] = useState(false);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const mappings = getAllMappings();

  function update(key: keyof Thresholds, value: string) {
    const n = parseFloat(value);
    setDraft(prev => ({ ...prev, [key]: isNaN(n) ? 0 : n }));
    setDirty(true);
  }

  function save() {
    onSaveThresholds(draft);
    setDirty(false);
  }

  function resetDefaults() {
    setDraft(DEFAULT_THRESHOLDS);
    setDirty(true);
  }

  const groups = Array.from(new Set(THRESHOLD_FIELDS.map(f => f.group)));

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full md:w-[480px] bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-blue-400" />
            <h3 className="text-white font-semibold text-base">Settings</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-slate-800 flex-shrink-0">
          {(['thresholds', 'holidays', 'mapping', 'share'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {t === 'thresholds' ? 'Thresholds' : t === 'mapping' ? 'Column Mapping' : t === 'holidays' ? 'Holidays' : 'Shared Link'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'thresholds' && (
            <div className="space-y-5">
              {groups.map(group => (
                <div key={group}>
                  <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">{group}</h4>
                  <div className="space-y-2">
                    {THRESHOLD_FIELDS.filter(f => f.group === group).map(f => (
                      <div key={f.key} className="flex items-center justify-between gap-3 bg-slate-800/60 rounded-lg px-3 py-2">
                        <label className="text-slate-300 text-xs">{f.label}</label>
                        <input
                          type="number"
                          value={draft[f.key]}
                          onChange={(e) => update(f.key, e.target.value)}
                          className="w-20 bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-white text-xs text-right focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={resetDefaults}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> Reset to Defaults
                </button>
                <button
                  onClick={save}
                  disabled={!dirty}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Save Thresholds
                </button>
              </div>
            </div>
          )}

          {tab === 'mapping' && (
            <div className="space-y-2">
              {Object.keys(mappings).length === 0 && (
                <p className="text-slate-500 text-sm">No column mappings saved yet — upload a CSV for a new office to create one.</p>
              )}
              {Object.entries(mappings).map(([office, mapping]) => (
                <div key={office} className="bg-slate-800/60 rounded-lg px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{office}</p>
                    <p className="text-slate-500 text-xs">{Object.keys(mapping).length} fields mapped</p>
                  </div>
                  <RemapButton officeCode={office} mapping={mapping} />
                </div>
              ))}
            </div>
          )}

          {tab === 'holidays' && (
            <div className="space-y-3">
              {!officeCode ? (
                <p className="text-slate-500 text-sm">Select a month/office on the dashboard first to view its holiday calendar.</p>
              ) : (
                <>
                  <div className="bg-slate-800/60 rounded-lg px-3 py-3">
                    <p className="text-white text-sm font-medium">{officeCode} · {year}</p>
                    <p className="text-slate-500 text-xs mt-1">
                      {holidays.length} holiday{holidays.length !== 1 ? 's' : ''} applied automatically across all charts and reports —
                      {' '}{holidays.filter(h => h.source === 'predefined').length} from the office calendar,
                      {' '}{holidays.filter(h => h.source === 'custom').length} custom.
                    </p>
                  </div>
                  <p className="text-slate-500 text-xs">
                    Office holidays (New Year, Diwali, etc.) are built into the app and applied automatically —
                    no manual entry needed. Use this to add extra regional/ad-hoc holidays or review the full list.
                  </p>
                  <button
                    onClick={() => setShowHolidayModal(true)}
                    className="flex items-center gap-1.5 bg-purple-600/20 border border-purple-500/30 text-purple-400 px-3 py-2 rounded-lg text-xs font-medium hover:bg-purple-600/30 transition-colors"
                  >
                    <Calendar className="w-3.5 h-3.5" /> View / Manage Holidays
                  </button>
                </>
              )}
            </div>
          )}

          {tab === 'share' && (
            <SharedLinkPanel records={records} />
          )}
        </div>
      </div>

      {showHolidayModal && officeCode && year && (
        <HolidayModal
          officeCode={officeCode}
          year={year}
          onClose={() => setShowHolidayModal(false)}
          onSaved={(h) => onHolidaysSaved?.(h)}
        />
      )}
    </>
  );
}

function RemapButton({ officeCode, mapping }: { officeCode: string; mapping: ColumnMapping }) {
  return (
    <>
      <input
        type="file"
        accept=".csv"
        id={`remap-${officeCode}`}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const Papa = (await import('papaparse')).default;
          Papa.parse(file, {
            header: true,
            preview: 1,
            complete: (results) => {
              const headers = results.meta.fields || [];
              // Surface old mapping + freshly-derived headers so app/page.tsx
              // can re-open ColumnMappingScreen pre-filled for adjustment.
              window.dispatchEvent(new CustomEvent('remap-headers', { detail: { officeCode, headers, mapping } }));
            },
          });
          e.target.value = '';
        }}
      />
      <button
        onClick={() => document.getElementById(`remap-${officeCode}`)?.click()}
        className="text-blue-400 hover:text-blue-300 text-xs font-medium px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
      >
        Remap →
      </button>
    </>
  );
}
