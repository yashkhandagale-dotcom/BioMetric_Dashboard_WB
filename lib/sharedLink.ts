import { AttendanceRecord } from './types';

const SHARE_KEY = 'shared_payload';

/**
 * HR side: compress records into base64, store in localStorage under a token key.
 * Returns a URL the manager can open on the same LAN.
 */
export function createSharedLink(records: AttendanceRecord[]): string {
  const token = crypto.randomUUID();
  const payload = JSON.stringify(records);
  // Store payload keyed by token so multiple links can coexist
  localStorage.setItem(`share_${token}`, payload);

  const ip = window.location.hostname;
  const port = window.location.port || '3000';
  return `http://${ip}:${port}/?view=1&token=${token}`;
}

export function regenerateSharedLink(records: AttendanceRecord[]): string {
  return createSharedLink(records);
}

/**
 * Manager side: read records from localStorage using the token in the URL.
 * Works because both HR and manager are on the same machine OR same browser session.
 *
 * For cross-machine sharing the HR machine must be the server AND
 * the manager opens the link — both hit the same Node process, same localStorage? No.
 *
 * Real solution: HR exports data into the URL hash as base64 so manager
 * gets the data embedded in the URL itself.
 */

// ── URL-embedded approach (works cross-machine) ──────────────────────────────

export function createSharedLinkWithData(records: AttendanceRecord[]): string {
  const json = JSON.stringify(records);
  // Simple base64 encode (browser built-in)
  const b64 = btoa(encodeURIComponent(json));
  const ip = window.location.hostname;
  const port = window.location.port || '3000';
  // Use hash so the server never sees the data
  return `http://${ip}:${port}/?view=1#data=${b64}`;
}

export function readSharedData(): AttendanceRecord[] | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.slice(1); // remove #
  const params = new URLSearchParams(hash);
  const b64 = params.get('data');
  if (!b64) return null;
  try {
    const json = decodeURIComponent(atob(b64));
    return JSON.parse(json) as AttendanceRecord[];
  } catch {
    return null;
  }
}
