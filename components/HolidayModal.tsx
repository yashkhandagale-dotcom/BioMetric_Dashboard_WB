'use client';
import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Calendar } from 'lucide-react';
import { Holiday } from '@/lib/types';
import { getHolidays, saveHolidays } from '@/lib/holidays';

interface HolidayModalProps {
  officeCode: string;
  year: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved?: (holidays: Holiday[]) => void;
}

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function getDayName(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return DAYS[d.getDay()];
  } catch { return ''; }
}

export default function HolidayModal({ officeCode, year, readOnly, onClose, onSaved }: HolidayModalProps) {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setHolidays(getHolidays(officeCode, year));
  }, [officeCode, year]);

  function addHoliday() {
    if (!newDate || !newName.trim()) return;
    const updated = [...holidays, { date: newDate, name: newName.trim(), source: 'custom' as const }]
      .sort((a, b) => a.date.localeCompare(b.date));
    setHolidays(updated);
    setNewDate('');
    setNewName('');
    setDirty(true);
  }

  function removeHoliday(idx: number) {
    const updated = holidays.filter((_, i) => i !== idx);
    setHolidays(updated);
    setDirty(true);
  }

  function handleSave() {
    saveHolidays(officeCode, year, holidays);
    setDirty(false);
    onSaved?.(holidays);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-purple-400" />
            <h2 className="text-white font-semibold text-sm">
              Holidays — {officeCode} ({year})
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {holidays.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-500 text-sm">
              No office holiday calendar found for {year}, and no custom holidays added yet.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="px-5 py-2 text-left font-medium">Date</th>
                  <th className="px-2 py-2 text-left font-medium">Day</th>
                  <th className="px-2 py-2 text-left font-medium">Name</th>
                  <th className="px-2 py-2 text-left font-medium">Source</th>
                  {!readOnly && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {holidays.map((h, i) => {
                  const isPredefined = h.source === 'predefined';
                  return (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-2.5 text-slate-300 font-mono">{h.date}</td>
                      <td className="px-2 py-2.5 text-slate-500">{getDayName(h.date)}</td>
                      <td className="px-2 py-2.5 text-white">{h.name}</td>
                      <td className="px-2 py-2.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${isPredefined ? 'bg-blue-600/20 text-blue-400' : 'bg-slate-700 text-slate-300'}`}>
                          {isPredefined ? 'Office calendar' : 'Custom'}
                        </span>
                      </td>
                      {!readOnly && (
                        <td className="px-3 py-2.5">
                          {!isPredefined && (
                            <button onClick={() => removeHoliday(i)} className="text-slate-600 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!readOnly && (
          <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/50">
            <p className="text-slate-500 text-xs mb-2">Add extra holiday (regional/ad-hoc, on top of the office calendar)</p>
            <div className="flex gap-2">
              <input
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                min={`${year}-01-01`}
                max={`${year}-12-31`}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500 flex-shrink-0"
              />
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Holiday name"
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 flex-1 min-w-0"
                onKeyDown={e => e.key === 'Enter' && addHoliday()}
              />
              <button
                onClick={addHoliday}
                disabled={!newDate || !newName.trim()}
                className="flex items-center gap-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white transition-colors">
            Cancel
          </button>
          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="px-4 py-1.5 rounded-lg text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              Save Holidays
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
