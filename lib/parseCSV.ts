import Papa from 'papaparse';
import { AttendanceRecord, ColumnMapping } from './types';

export interface ParseResult {
  records: AttendanceRecord[];
  duplicatesSkipped: number;
  headers: string[];
}

export function parseCSVHeaders(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      preview: 1,
      complete: (results) => { resolve(results.meta.fields || []); },
      error: reject,
    });
  });
}

function timeToMinutes(timeStr: string): number {
  if (!timeStr || timeStr === '0:00' || timeStr === '--' || timeStr === '') return 0;
  const parts = timeStr.split(':');
  if (parts.length < 2) return 0;
  const hours = parseInt(parts[0], 10) || 0;
  const mins = parseInt(parts[1], 10) || 0;
  return hours * 60 + mins;
}

function countPunches(punchRecords?: string): number {
  if (!punchRecords || punchRecords.trim() === '') return 1;
  // Count comma-separated entries, pairs of in/out = punchCount
  const parts = punchRecords.split(',').map(p => p.trim()).filter(Boolean);
  return Math.max(1, Math.ceil(parts.length / 2));
}

function isPunchTimeValid(timeStr: string): boolean {
  if (!timeStr || timeStr === '0:00' || timeStr === '--' || timeStr === '') return false;
  return true;
}

function normalizeStatus(
  statusStr: string,
  inTimeStr: string,
  outTimeStr: string
): string {
  const hasInPunch = isPunchTimeValid(inTimeStr);
  const hasOutPunch = isPunchTimeValid(outTimeStr);

  // If punch in exists but punch out doesn't → Missed Punch Out
  if (hasInPunch && !hasOutPunch) {
    return 'Missed Punch Out';
  }

  // If no punches at all → mark as Absent (unless already marked differently)
  if (!hasInPunch && !hasOutPunch) {
    const statusLower = statusStr.toLowerCase();
    if (statusLower.includes('absent')) return statusStr; // keep as is
    if (statusLower.includes('present')) return 'Absent'; // mark absent if marked present but no punches
    return 'Absent';
  }

  // If both punches exist or other cases → use original status
  return statusStr;
}

export function parseCSVWithMapping(
  file: File,
  mapping: ColumnMapping,
  officeCode: string,
  graceMinutes: number = 10
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as Record<string, string>[];
        const seen = new Set<string>();
        let duplicatesSkipped = 0;
        const records: AttendanceRecord[] = [];

        const mappedHeaders = new Set(Object.values(mapping));
        const allHeaders = results.meta.fields || [];

        for (const row of rows) {
          const empCode = String(row[mapping.employeeCode] || '').trim();
          const date = String(row[mapping.date] || '').trim();

          if (!empCode || !date) continue;

          const dedupeKey = `${empCode}_${date}_${officeCode}`;
          if (seen.has(dedupeKey)) { duplicatesSkipped++; continue; }
          seen.add(dedupeKey);

          const lateByStr = String(row[mapping.lateBy] || '').trim();
          const earlyByStr = String(row[mapping.earlyBy] || '').trim();
          const durationStr = String(row[mapping.duration] || '0:00').trim();
          let statusStr = String(row[mapping.status] || '').trim();
          const inTimeStr = String(row[mapping.inTime] || '').trim();
          const outTimeStr = String(row[mapping.outTime] || '').trim();

          // Normalize status based on punch presence:
          // - If punch in exists but no punch out → "Missed Punch Out"
          // - If no punches at all → "Absent"
          statusStr = normalizeStatus(statusStr, inTimeStr, outTimeStr);

          // Detect punch records column (common variations)
          const punchRecordsRaw = row['Punch Records'] || row['punch_records'] || row['PunchRecords'] || '';
          const punchCount = countPunches(punchRecordsRaw);

          // Short day: present but duration ≤ 5 minutes
          const durationMins = durationToMinutes(durationStr);
          const presCheck = statusStr.toLowerCase().includes('present') && !statusStr.toLowerCase().includes('absent');
          const isShortDay = presCheck && durationMins <= 5 && durationMins > 0;

          // A5: prefer CSV's lateBy/earlyBy when present & parseable; fall back to
          // computing from raw in/out punches (with grace period) otherwise.
          const hasValidLateBy = lateByStr !== '' && /^\d+:\d+$/.test(lateByStr);
          const hasValidEarlyBy = earlyByStr !== '' && /^\d+:\d+$/.test(earlyByStr);

          // B1: preserve any unmapped CSV columns instead of dropping them
          let extraFields: Record<string, string> | undefined;
          for (const h of allHeaders) {
            if (mappedHeaders.has(h) || h === 'Punch Records' || h === 'punch_records' || h === 'PunchRecords') continue;
            if (row[h] === undefined || row[h] === '') continue;
            if (!extraFields) extraFields = {};
            extraFields[h] = String(row[h]);
          }

          records.push({
            date,
            employeeCode: empCode,
            employeeName: String(row[mapping.employeeName] || '').trim(),
            department: String(row[mapping.department] || 'Unknown').trim() || 'Unknown',
            inTime: inTimeStr,
            outTime: outTimeStr,
            status: statusStr,
            punchRecords: punchRecordsRaw || undefined,
            lateBy: hasValidLateBy ? lateByStr : '0:00',
            earlyBy: hasValidEarlyBy ? earlyByStr : '0:00',
            duration: durationStr,
            officeCode,
            punchCount,
            isShortDay,
            extraFields,
            lateIsEstimated: !hasValidLateBy,
            earlyIsEstimated: !hasValidEarlyBy,
          });
        }

        resolve({ records, duplicatesSkipped, headers: results.meta.fields || [] });
      },
      error: reject,
    });
  });
}

export function durationToMinutes(durationStr: string): number {
  if (!durationStr || durationStr === '0:00' || durationStr === '--') return 0;
  const parts = durationStr.split(':');
  const hours = parseInt(parts[0], 10) || 0;
  const mins = parseInt(parts[1], 10) || 0;
  return hours * 60 + mins;
}

export function minutesToHHMM(minutes: number): string {
  if (minutes <= 0) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}
