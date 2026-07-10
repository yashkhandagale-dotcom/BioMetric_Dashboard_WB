'use client';
import { useState } from 'react';
import { X, Settings as SettingsIcon, RotateCcw } from 'lucide-react';
import { ColumnMapping, Thresholds, AttendanceRecord } from '@/lib/types';
import { getAllMappings } from '@/lib/storage';
import { DEFAULT_THRESHOLDS } from '@/lib/settings';
import { getAllKnownDepartments, addDepartment, getDeletedEmployees, restoreEmployee } from '@/lib/employeeStore';
import SharedLinkPanel from './SharedLinkPanel';
import BackupPanel from './BackupPanel';

interface SettingsPanelProps {
  onClose: () => void;
  thresholds: Thresholds;
  onSaveThresholds: (t: Thresholds) => void;
  records: AttendanceRecord[];
  onDataChanged?: () => void; // called after a restore so the dashboard re-pulls records
}

const THRESHOLD_FIELDS: { key: keyof Thresholds; label: string; group: string }[] = [
  { key: 'attendanceRateGreen', label: 'Attendance Rate — Green ≥', group: 'Attendance Rate (%)' },
  { key: 'attendanceRateAmber', label: 'Attendance Rate — Amber ≥', group: 'Attendance Rate (%)' },
  // { key: 'absenteeismRateGreen', label: 'Absenteeism Rate — Green <', group: 'Absenteeism Rate (%)' },
  // { key: 'absenteeismRateAmber', label: 'Absenteeism Rate — Amber <', group: 'Absenteeism Rate (%)' },
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

function minsToHHMM(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}
function hhmmToMins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

export default function SettingsPanel({ onClose, thresholds, onSaveThresholds, records, onDataChanged }: SettingsPanelProps) {
  const [tab, setTab] = useState<'mapping' | 'thresholds' | 'share' | 'backup' | 'departments'>('thresholds');
  const [draft, setDraft] = useState<Thresholds>(thresholds);
  const [dirty, setDirty] = useState(false);
  const mappings = getAllMappings();

  const [departments, setDepartments] = useState<string[]>(() => getAllKnownDepartments(records));
  const [newDeptName, setNewDeptName] = useState('');
  const [deptError, setDeptError] = useState<string | null>(null);
  const [deletedEmployees, setDeletedEmployees] = useState(() => getDeletedEmployees());

  function handleRestoreEmployee(employeeCode: string, officeCode: string) {
    restoreEmployee(employeeCode, officeCode);
    setDeletedEmployees(getDeletedEmployees());
    onDataChanged?.();
  }

  function handleAddDepartment() {
    const trimmed = newDeptName.trim();
    if (!trimmed) return;
    const ok = addDepartment(trimmed, departments);
    if (!ok) {
      setDeptError(`"${trimmed}" already exists.`);
      return;
    }
    setDeptError(null);
    setNewDeptName('');
    setDepartments(getAllKnownDepartments(records));
  }

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

        <div className="flex border-b border-slate-800 flex-shrink-0 overflow-x-auto">
          {(['thresholds', 'mapping', 'departments', 'share', 'backup'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {t === 'thresholds' ? 'Thresholds' : t === 'mapping' ? 'Column Mapping' : t === 'departments' ? 'Departments' : t === 'share' ? 'Shared Link' : 'Backup'}
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

              {/* Shift Window — time-picker instead of raw number */}
              <div>
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">Shift Window</h4>
                <p className="text-slate-500 text-[11px] mb-2">Used to compute Late Arrival and Early Exit rates. If your CSV already has lateBy/earlyBy columns the system prefers those; this only applies when falling back to raw punch times.</p>
                <div className="space-y-2">
                  {(['shiftStartMinutes', 'shiftEndMinutes'] as const).map((key) => (
                    <div key={key} className="flex items-center justify-between gap-3 bg-slate-800/60 rounded-lg px-3 py-2">
                      <label className="text-slate-300 text-xs">{key === 'shiftStartMinutes' ? 'Shift Start' : 'Shift End'}</label>
                      <input
                        type="time"
                        value={minsToHHMM(draft[key])}
                        onChange={(e) => { setDraft(prev => ({ ...prev, [key]: hhmmToMins(e.target.value) })); setDirty(true); }}
                        className="bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

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

          {tab === 'departments' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">Create Department</h4>
                <p className="text-slate-500 text-[11px] mb-2">
                  New departments show up as an assignable option on each employee&apos;s panel right away,
                  even before any employee is moved into them.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDeptName}
                    onChange={(e) => { setNewDeptName(e.target.value); setDeptError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddDepartment(); }}
                    placeholder="e.g. Customer Success"
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleAddDepartment}
                    disabled={!newDeptName.trim()}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>
                {deptError && <p className="text-red-400 text-xs mt-1.5">{deptError}</p>}
              </div>

              <div>
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">
                  All Departments ({departments.length})
                </h4>
                {departments.length === 0 ? (
                  <p className="text-slate-500 text-sm">No departments yet — upload a CSV or create one above.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {departments.map((d) => (
                      <span key={d} className="bg-slate-800/60 border border-slate-700 text-slate-300 text-xs px-2.5 py-1 rounded-lg">
                        {d}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-slate-500 text-[11px] mt-2">
                  To move an individual employee into a different department, open their profile from the
                  Employees table and use the department dropdown there.
                </p>
              </div>

              <div>
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">
                  Deleted Employees ({deletedEmployees.length})
                </h4>
                <p className="text-slate-500 text-[11px] mb-2">
                  Deleted employees are hidden from every chart, table and export — even if a future CSV
                  re-imports their attendance rows. Restore them here if that was a mistake.
                </p>
                {deletedEmployees.length === 0 ? (
                  <p className="text-slate-500 text-sm">No deleted employees.</p>
                ) : (
                  <div className="space-y-1.5">
                    {deletedEmployees.map((e) => (
                      <div
                        key={`${e.employeeCode}__${e.officeCode}`}
                        className="flex items-center justify-between bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2"
                      >
                        <div>
                          <span className="text-white text-sm">{e.employeeName}</span>
                          <span className="text-slate-500 text-xs ml-2">{e.department} · {e.officeCode}</span>
                        </div>
                        <button
                          onClick={() => handleRestoreEmployee(e.employeeCode, e.officeCode)}
                          className="text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'share' && (
            <SharedLinkPanel records={records} />
          )}

          {tab === 'backup' && (
            <BackupPanel />
          )}
        </div>
      </div>
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