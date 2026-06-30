import { ColumnMapping } from './types';

export const FIELD_SYNONYMS: Record<keyof ColumnMapping, string[]> = {
  employeeCode: ['empid', 'employeeid', 'empcode', 'staffid', 'id', 'employeecode'],
  employeeName: ['empname', 'name', 'staffname', 'fullname', 'employeename'],
  date: ['attendancedate', 'punchdate', 'date'],
  inTime: ['checkin', 'intime', 'punchin', 'firstin', 'in'],
  outTime: ['checkout', 'outtime', 'punchout', 'lastout', 'out'],
  status: ['attendancestatus', 'daystatus', 'status'],
  lateBy: ['late', 'latemins', 'lateduration', 'lateby'],
  earlyBy: ['early', 'earlymins', 'earlyduration', 'earlyleaving', 'earlyby'],
  duration: ['workinghours', 'totalhours', 'hoursworked', 'workdur', 'duration', 'hours'],
  department: ['dept', 'team', 'division', 'department'],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./]+/g, '').replace(/[^a-z0-9]/g, '');
}

// Simple Levenshtein distance for fallback fuzzy matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export interface AutoMatchResult {
  mapping: Partial<ColumnMapping>;
  autoMatched: Set<keyof ColumnMapping>;
  unmatchedHeaders: string[];
}

/** Best-effort auto-match of CSV headers to the 10 standard fields. */
export function autoMatchColumns(csvHeaders: string[]): AutoMatchResult {
  const normHeaders = csvHeaders.map((h) => ({ raw: h, norm: normalize(h) }));
  const mapping: Partial<ColumnMapping> = {};
  const autoMatched = new Set<keyof ColumnMapping>();
  const consumed = new Set<string>();

  for (const field of Object.keys(FIELD_SYNONYMS) as (keyof ColumnMapping)[]) {
    const synonyms = FIELD_SYNONYMS[field];

    // 1) exact normalized synonym match
    let found = normHeaders.find((h) => !consumed.has(h.raw) && synonyms.includes(h.norm));

    // 2) substring match
    if (!found) {
      found = normHeaders.find(
        (h) => !consumed.has(h.raw) && synonyms.some((syn) => h.norm.includes(syn) || syn.includes(h.norm))
      );
    }

    // 3) Levenshtein fallback — only accept reasonably confident matches
    if (!found) {
      let best: { h: { raw: string; norm: string }; dist: number } | null = null;
      for (const h of normHeaders) {
        if (consumed.has(h.raw)) continue;
        for (const syn of synonyms) {
          const dist = levenshtein(h.norm, syn);
          const threshold = Math.max(2, Math.floor(syn.length * 0.3));
          if (dist <= threshold && (!best || dist < best.dist)) best = { h, dist };
        }
      }
      if (best) found = best.h;
    }

    if (found) {
      mapping[field] = found.raw;
      autoMatched.add(field);
      consumed.add(found.raw);
    }
  }

  const unmatchedHeaders = csvHeaders.filter((h) => !consumed.has(h));
  return { mapping, autoMatched, unmatchedHeaders };
}
