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
// order == chronological order. If the raw export uses DD-MM-YYYY (common
// for Indian biometric machines) this assumption silently breaks: e.g.
// "31-05-2026" (May 31) string-sorts AFTER "30-06-2026" (June 30), so the
// picker's max date gets stuck in May and June becomes unselectable.
// Normalizing once here, at ingestion, fixes every downstream consumer at
// once instead of patching each sort/comparison site individually.
export function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (!s) return s;

  // Already ISO: YYYY-MM-DD — leave as-is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // ISO with a time component tacked on (e.g. "2026-06-01T00:00:00" or
  // "2026-06-01 00:00:00") — keep just the date part.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo}-${d}`;
  }

  // DD-MM-YYYY or DD/MM/YYYY, optionally with a trailing time component
  // (most common biometric export format).
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T ].*)?$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY/MM/DD or YYYY-M-D variants.
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Unrecognized format — don't silently mangle it, but warn loudly so this
  // shows up in the console instead of causing a mystery date-picker bug.
  console.warn(`[parseCSV] Unrecognized date format "${raw}" — left as-is; this may break date sorting/filtering.`);
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

        for (const row of rows) {
          const empCode = String(row[mapping.employeeCode] || '').trim();
          const date = normalizeDate(String(row[mapping.date] || '').trim());

          if (!empCode || !date) continue;

          const dedupeKey = `${empCode}_${date}_${officeCode}`;
          if (seen.has(dedupeKey)) { duplicatesSkipped++; continue; }
          seen.add(dedupeKey);

          const lateByStr = String(row[mapping.lateBy] || '').trim();
          const earlyByStr = String(row[mapping.earlyBy] || '').trim();
          let durationStr = String(row[mapping.duration] || '0:00').trim();
          let statusStr = String(row[mapping.status] || '').trim();
          const inTimeStr = String(row[mapping.inTime] || '').trim();
          const outTimeStr = String(row[mapping.outTime] || '').trim();

          // Auto-calculate duration from In Time and Out Time if Duration is missing, blank, or 0:00
          if ((!durationStr || durationStr === '0:00' || durationStr === '--') && isPunchTimeValid(inTimeStr) && isPunchTimeValid(outTimeStr)) {
            const inMins = timeToMinutes(inTimeStr);
            const outMins = timeToMinutes(outTimeStr);
            const diff = outMins >= inMins ? outMins - inMins : (outMins + 1440) - inMins; // handles night shifts
            durationStr = minutesToHHMM(diff);
          }

          // Detect punch records column (common variations)
          const punchRecordsRaw = row['Punch Records'] || row['punch_records'] || row['PunchRecords'] || '';
          const punchCount = countPunches(punchRecordsRaw);

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
}

export function analyzeCSVDateRange(
  file: File,
  dateColumn: string,
  employeeColumn: string
): Promise<CSVDateRangeAnalysis> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as Record<string, string>[];
        let minDate = '';
        let maxDate = '';
        let totalRecords = 0;
        const empSet = new Set<string>();
        const monthSet = new Set<string>();

        for (const row of rows) {
          const rawDate = String(row[dateColumn] || '').trim();
          const empCode = String(row[employeeColumn] || '').trim();
          if (!rawDate) continue;

          const date = normalizeDate(rawDate);
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
        });
      },
      error: reject,
    });
  });
}