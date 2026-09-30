// Thresholds and default configuration for HR Leave Analytics

export const FREQUENT_SPELLS_90D = 4;
export const SHORT_SPELL_MAX_DAYS = 2;
export const NO_RECENT_LEAVE_DAYS = 180;
export const MIN_SPELLS_FOR_BRIDGE_FLAG = 3;
export const LOW_BALANCE_DAYS = 1; // SL/CL threshold for low balance alert
export const HIGH_UNUSED_BALANCE_RATIO = 0.8; // >= 80% of allocated closing balance
export const HIGH_UNUSED_BALANCE_MIN_MONTHS_ELAPSED = 9; // FY elapsed months threshold

export const BRADFORD_BANDS = {
  LOW: { min: 0, max: 49, key: 'low', label: 'Low', description: 'Normal / minimal disruption' },
  MODERATE: { min: 50, max: 124, key: 'moderate', label: 'Moderate', description: 'Review trigger / pattern alert' },
  HIGH: { min: 125, max: 399, key: 'high', label: 'High', description: 'Formal review recommended' },
  CRITICAL: { min: 400, max: Infinity, key: 'critical', label: 'Critical', description: 'Urgent HR escalation' },
} as const;

export type BradfordBandKey = 'low' | 'moderate' | 'high' | 'critical';

export function getBradfordBand(score: number): {
  key: BradfordBandKey;
  label: string;
  description: string;
} {
  if (score >= BRADFORD_BANDS.CRITICAL.min) {
    return BRADFORD_BANDS.CRITICAL;
  }
  if (score >= BRADFORD_BANDS.HIGH.min) {
    return BRADFORD_BANDS.HIGH;
  }
  if (score >= BRADFORD_BANDS.MODERATE.min) {
    return BRADFORD_BANDS.MODERATE;
  }
  return BRADFORD_BANDS.LOW;
}
