'use client';

import { useState } from 'react';
import Link from 'next/link';
import CreateLoginForm from './CreateLoginForm';
import BulkLoginsForm from './BulkLoginsForm';

// Was a CSV-only bulk import page. That tool was only ever meant for the
// one-time initial migration (see BulkLoginsForm.tsx's own header
// comment) — day-to-day, HR just needs to create ONE login at a time for
// a new joiner, so that's the default view now. The CSV importer still
// exists (nothing about the underlying data changes), just tucked behind
// "Advanced: bulk import" for the rare case a whole batch needs
// provisioning again.
export default function LoginsPageClient() {
  const [showBulk, setShowBulk] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <Link href="/leave/admin" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            ← Back to Employees
          </Link>
          <h1 className="text-xl font-semibold mt-1">Create Login</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Set a new employee up with a login. They can sign in immediately with the password you set here, and
            change it themselves afterward from their account.
          </p>
        </div>

        <CreateLoginForm />

        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowBulk((v) => !v)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline underline-offset-2"
          >
            {showBulk ? 'Hide advanced: bulk CSV import' : 'Advanced: bulk CSV import (one-time migrations only)'}
          </button>
          {showBulk && (
            <div className="mt-4 space-y-3">
              <p className="text-[var(--text-muted)] text-xs max-w-2xl">
                Paste a CSV of employee_code, email, and password to create many logins at once. This is for a
                one-off bulk backfill (e.g. onboarding a whole existing roster at once) — for routine day-to-day
                additions, use Create Login above instead.
              </p>
              <BulkLoginsForm />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
