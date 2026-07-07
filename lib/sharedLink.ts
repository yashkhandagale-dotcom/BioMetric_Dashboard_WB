import { AttendanceRecord } from './types';

/**
 * HR side: send records to the server-side shared-link store and get back a
 * short-lived, unguessable token. The URL only ever contains that token —
 * never the underlying employee PII — and the server-side entry expires
 * automatically (see app/api/shared-link/route.ts).
 */
export async function createSharedLink(records: AttendanceRecord[]): Promise<string> {
  const res = await fetch('/api/shared-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  if (!res.ok) throw new Error('Failed to generate shared link');
  const { token } = await res.json();

  const ip = window.location.hostname;
  const port = window.location.port ? `:${window.location.port}` : '';
  return `${window.location.protocol}//${ip}${port}/?view=1&token=${token}`;
}

/**
 * Manager side: given the token in the URL, fetch the underlying records
 * same-origin from the server. Returns null if the token is missing, invalid,
 * or the link has expired.
 */
export async function readSharedData(): Promise<AttendanceRecord[] | null> {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return null;

  try {
    const res = await fetch(`/api/shared-link?token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const { records } = await res.json();
    return Array.isArray(records) && records.length > 0 ? (records as AttendanceRecord[]) : null;
  } catch {
    return null;
  }
}
