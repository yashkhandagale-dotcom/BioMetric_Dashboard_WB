export interface ValidationResult {
  valid: boolean;
  error?: string;
  officeCode?: string;
  month?: string;
  year?: string;
}

const FILENAME_REGEX = /^(\d{4})_(\d{2})_([A-Z]{2,6})\.csv$/;
const LOOSE_FILENAME_REGEX = /^(\d{4})_(\d{2})_([A-Z]+)\.csv$/;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateFile(file: File): ValidationResult {
  // Step 1: filename format
  const match = file.name.match(FILENAME_REGEX);
  if (!match) {
    // Distinguish "right shape, wrong office-code length" from "wrong shape entirely"
    const looseMatch = file.name.match(LOOSE_FILENAME_REGEX);
    if (looseMatch) {
      const code = looseMatch[3];
      return {
        valid: false,
        error: `Office code must be 2–6 uppercase letters. Got: '${code}' (${code.length} characters).`,
      };
    }
    return {
      valid: false,
      error: `Filename must follow YYYY_MM_OFFICECODE.csv — example: 2026_05_MUM.csv\nYour file: "${file.name}"`,
    };
  }

  const [, year, month, officeCode] = match;

  // Step 2: file size
  if (file.size > MAX_SIZE_BYTES) {
    return {
      valid: false,
      error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed: 5 MB.`,
    };
  }

  return { valid: true, officeCode, month, year };
}

export const REQUIRED_STANDARD_FIELDS = [
  'employeeCode',
  'employeeName',
  'date',
  'inTime',
  'outTime',
  'status',
  'lateBy',
  'earlyBy',
  'duration',
  'department',
] as const;

export const FIELD_LABELS: Record<string, string> = {
  employeeCode: 'Employee Code / ID',
  employeeName: 'Employee Name',
  date: 'Date',
  inTime: 'In Time',
  outTime: 'Out Time',
  status: 'Status',
  lateBy: 'Late By',
  earlyBy: 'Early By',
  duration: 'Duration',
  department: 'Department',
};
