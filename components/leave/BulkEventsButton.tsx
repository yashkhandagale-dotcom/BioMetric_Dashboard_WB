'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import BulkEventsModal from './BulkEventsModal';

export default function BulkEventsButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-[var(--border)] hover:border-[var(--border)] text-[var(--text-primary)] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        Bulk Events
      </button>
      {open && (
        <BulkEventsModal
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
