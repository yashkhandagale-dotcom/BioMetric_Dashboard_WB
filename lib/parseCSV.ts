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

// Row dates come straight from the biometric export's CSV column with no
// guaranteed format. Everything downstream (page.tsx's date-range picker,
// useDashboardData's `r.date < dateFrom` filtering, various `.sort()` calls,
// and the HTML <input type="date"> values themselves) assumes strict ISO
// "YYYY-MM-DD" strings, because that's the only format where lexical string
// order == chronological order.
//
// dateFormat hint (from the user-chosen column mapping):
//   'DMY' = DD/MM/YYYY  — Indian biometric default
//   'MDY' = MM/DD/YYYY  — US / some software exports
//   'YMD' = YYYY-MM-DD  — ISO (already handled in all paths)
export function normalizeDate(raw: string, dateFormat?: 'DMY' | 'MDY' | 'YMD'): string {
  const s = raw.trim();
  if (!s) return s;

  // Already ISO: YYYY-MM-DD — leave as-is regardless of hint.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // ISO with a time component tacked on (e.g. "2026-06-01T00:00:00").
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo}-${d}`;
  }

  // YYYY/MM/DD or YYYY-M-D variants.
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Two-part date: D/M/YYYY or M/D/YYYY — the ambiguous case.
  // Use the stored dateFormat hint when available; fall back to
  // positional heuristics (any value > 12 must be the day).
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T ].*)?$/);
  if (m) {
    const [, p1, p2, y] = m;
    const n1 = parseInt(p1, 10);
    const n2 = parseInt(p2, 10);

    let month: number;
    let day: number;

    if (dateFormat === 'MDY') {
      // MM/DD/YYYY — unless n1 > 12, which is impossible for a month
      if (n1 > 12 && n2 <= 12) { month = n2; day = n1; }
      else { month = n1; day = n2; }
    } else if (dateFormat === 'DMY') {
      // DD/MM/YYYY — unless n2 > 12, which is impossible for a month
      if (n2 > 12 && n1 <= 12) { month = n1; day = n2; }
      else { month = n2; day = n1; }
    } else {
      // No explicit hint — deduce from values:
      // if n2 > 12 it can only be a day, so n1 is the month (MDY-style)
      // if n1 > 12 it can only be a day, so n2 is the month (DMY-style)
      // if both <= 12 we can't tell, default to DMY (most common in India)
      if (n2 > 12 && n1 <= 12) { month = n1; day = n2; }
      else { month = n2; day = n1; }
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Unrecognized format.
  console.warn(`[parseCSV] Unrecognized date format "${raw}" — left as-is.`);
  return s;
}

export function isPunchTimeValid(timeStr: string): boolean {
  if (!timeStr) return false;
  const normalized = timeStr.trim();
  // Handle various empty/null representations
  if (!normalized || normalized === '0:00' || normalized === '--' || normalized === '—' || normalized === '-') return false;
  return true;
}

function normalizeStatus(
  statusStr: string,
  inTimeStr: string,
  outTimeStr: string,
  dateStr: string,
  punchCount: number
): string {
  const hasInPunch = isPunchTimeValid(inTimeStr);
  const hasOutPunch = isPunchTimeValid(outTimeStr);

  // If punch in exists but punch out doesn't → Missed Punch Out
  if (hasInPunch && !hasOutPunch) {
    return 'Missed Punch Out';
  }

  // If there are punch records → use actual status (never Weekly Off if they punched)
  if (hasInPunch || hasOutPunch || punchCount > 0) {
    return statusStr;
  }

  // If no punches at all → determine status
  if (!hasInPunch && !hasOutPunch) {
    const statusLower = statusStr.toLowerCase();
    
    // Check if it's a weekend (Saturday=6, Sunday=0)
    try {
      const date = new Date(dateStr);
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      
      // If it's a weekend with no punches and marked as Weekly Off → keep it
      if (isWeekend && statusLower.includes('weeklyoff')) {
        return statusStr; // keep as is
      }
    } catch (e) {
      // If date parsing fails, continue with normal logic
    }
    
    // If marked absent → keep as is
    if (statusLower.includes('absent')) return statusStr;
    // If marked present but no punches → mark as Absent
    if (statusLower.includes('present')) return 'Absent';
    // Default to Absent
    return 'Absent';
  }

  // If both punches exist or other cases → use original status
  return statusStr;
}

export function parseCSVWithMapping(
  file: File,
  mapping: ColumnMapping,
  officeCode: string,
  graceMinutes: number = 10,
  shortDayMinutes: number = 5
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

        const detectedFmt = detectDateFormatFromRows(rows, mapping.date);
        const effectiveDateFormat = mapping.dateFormat || detectedFmt || 'DMY';

        for (const row of rows) {
          const empCode = String(row[mapping.employeeCode] || '').trim();
          const date = normalizeDate(String(row[mapping.date] || '').trim(), effectiveDateFormat);

          if (!empCode || !date) continue;

          const dedupeKey = `${empCode}_${date}_${officeCode}`;
          if (seen.has(dedupeKey)) { duplicatesSkipped++; continue; }
          seen.add(dedupeKey);

          const lateByStr = String(row[mapping.lateBy] || '').trim();
          const earlyByStr = String(row[mapping.earlyBy] || '').trim();
          let durationStr = String(row[mapping.duration] || '0:00').trim();
          let statusStr = String(row[mapping.status] || '').trim();
          let inTimeStr = String(row[mapping.inTime] || '').trim();
          let outTimeStr = String(row[mapping.outTime] || '').trim();

          // Detect punch records column (common variations)
          const punchRecordsRaw = row['Punch Records'] || row['punch_records'] || row['PunchRecords'] || '';
          const punchCount = countPunches(punchRecordsRaw);

          // If employee is marked Absent or WeeklyOff, and has ZERO actual punches:
          // In some biometric software (e.g. eSSL/BioTrack), the export report dumps scheduled shift times
          // (like 9:30 and 18:30) into In Time / Out Time columns even when the person was completely absent.
          // Clear these ghost shift times so absent employees don't show fake 8-hour punches!
          const isAbsentOrOff = statusStr.toLowerCase().includes('absent') || statusStr.toLowerCase().includes('weeklyoff');
          const isNoPunchActivity = punchCount === 0 && (durationStr === '0:00' || !durationStr || durationStr === '--');
          if (isAbsentOrOff && isNoPunchActivity) {
            inTimeStr = '';
            outTimeStr = '';
            durationStr = '0:00';
          }

          // Auto-calculate duration from In Time and Out Time if Duration is missing, blank, or 0:00 (ONLY for non-absent rows with punches)
          if (!isAbsentOrOff && (!durationStr || durationStr === '0:00' || durationStr === '--') && isPunchTimeValid(inTimeStr) && isPunchTimeValid(outTimeStr)) {
            const inMins = timeToMinutes(inTimeStr);
            const outMins = timeToMinutes(outTimeStr);
            const diff = outMins >= inMins ? outMins - inMins : (outMins + 1440) - inMins; // handles night shifts
            durationStr = minutesToHHMM(diff);
          }

          // Normalize status based on punch presence:
          // - If punch in exists but no punch out → "Missed Punch Out"
          // - If no punches at all → "Absent"
          statusStr = normalizeStatus(statusStr, inTimeStr, outTimeStr, date, punchCount);

          // Short day: present but duration <= configured Short Day threshold
          // (Settings -> Other Thresholds -> Short Day threshold). Previously
          // hardcoded to 5 minutes regardless of that setting, so changing
          // the threshold in Settings had no effect on classification.
          const durationMins = durationToMinutes(durationStr);
          const presCheck = statusStr.toLowerCase().includes('present') && !statusStr.toLowerCase().includes('absent');
          const isShortDay = presCheck && durationMins <= shortDayMinutes && durationMins > 0;

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

// Effective worked minutes = raw punch duration minus the 1h lunch, matching
// computeProductivityLostMinutes in lib/useDashboardData.ts. If someone
// barely punched in (<=60 min total), there's no lunch to subtract.
export function effectiveMinutes(durationMinutes: number): number {
  if (durationMinutes <= 0) return 0;
  const lunch = durationMinutes > 60 ? 60 : 0;
  return durationMinutes - lunch;
}

// ── CSV Date-Range Analyzer ───────────────────────────────────────────────────
// Reads ONLY the date column (fast, single-pass) to determine the actual
// coverage period of a CSV file without fully parsing every field. This is
// called before any DB write so the ImportPreviewModal can show the user
// exactly what they are about to import.

export interface CSVDateRangeAnalysis {
  startDate: string;        // YYYY-MM-DD — earliest record date
  endDate: string;          // YYYY-MM-DD — latest record date
  totalRecords: number;     // total data rows
  uniqueEmployees: number;  // distinct employee codes
  monthsSpanned: { year: string; month: string; label: string }[];
  detectedDateFormat?: 'DMY' | 'MDY' | 'YMD';
}

export function detectDateFormatFromRows(
  rows: Record<string, string>[],
  dateColumn: string
): 'DMY' | 'MDY' | 'YMD' | null {
  let mdyCount = 0;
  let dmyCount = 0;
  let ymdCount = 0;

  for (const row of rows) {
    const raw = String(row[dateColumn] || '').trim();
    if (!raw) continue;

    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw)) {
      ymdCount++;
      continue;
    }

    const m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (m) {
      const n1 = parseInt(m[1], 10);
      const n2 = parseInt(m[2], 10);
      if (n2 > 12 && n1 <= 12) mdyCount++;
      else if (n1 > 12 && n2 <= 12) dmyCount++;
    }
  }

  if (mdyCount > 0 && dmyCount === 0) return 'MDY';
  if (dmyCount > 0 && mdyCount === 0) return 'DMY';
  if (ymdCount > 0 && mdyCount === 0 && dmyCount === 0) return 'YMD';
  return null;
}

export function analyzeCSVDateRange(
  file: File,
  dateColumn: string,
  employeeColumn: string,
  dateFormat?: 'DMY' | 'MDY' | 'YMD',
  forceFormat: boolean = false
): Promise<CSVDateRangeAnalysis> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as Record<string, string>[];
        const detectedFmt = detectDateFormatFromRows(rows, dateColumn);
        const effectiveFormat: 'DMY' | 'MDY' | 'YMD' = forceFormat
          ? (dateFormat || 'DMY')
          : (detectedFmt || dateFormat || 'DMY');

        let minDate = '';
        let maxDate = '';
        let totalRecords = 0;
        const empSet = new Set<string>();
        const monthSet = new Set<string>();

        for (const row of rows) {
          const rawDate = String(row[dateColumn] || '').trim();
          const empCode = String(row[employeeColumn] || '').trim();
          if (!rawDate) continue;

          const date = normalizeDate(rawDate, effectiveFormat);
          if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

          totalRecords++;
          if (empCode) empSet.add(empCode);

          if (!minDate || date < minDate) minDate = date;
          if (!maxDate || date > maxDate) maxDate = date;

          // Track YYYY-MM
          const ym = date.substring(0, 7);
          monthSet.add(ym);
        }

        if (!minDate || !maxDate) {
          reject(new Error('Could not detect any valid dates in the CSV. Please check the date column mapping.'));
          return;
        }

        const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthsSpanned = Array.from(monthSet)
          .sort()
          .map((ym) => {
            const [year, month] = ym.split('-');
            return { year, month, label: `${MONTH_NAMES[parseInt(month, 10)]} ${year}` };
          });

        resolve({
          startDate: minDate,
          endDate: maxDate,
          totalRecords,
          uniqueEmployees: empSet.size,
          monthsSpanned,
          detectedDateFormat: effectiveFormat,
        });
      },
      error: reject,
    });
  });
}