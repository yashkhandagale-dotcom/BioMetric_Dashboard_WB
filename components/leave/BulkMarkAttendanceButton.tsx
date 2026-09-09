'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarCheck } from 'lucide-react';
import BulkMarkAttendanceModal from './BulkMarkAttendanceModal';

interface BulkMarkAttendanceButtonProps {
  variant?: 'outline' | 'primary';
  className?: string;
}

export default function BulkMarkAttendanceButton({ variant = 'outline', className = '' }: BulkMarkAttendanceButtonProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const baseStyle =
    variant === 'primary'
      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
      : 'border border-[var(--border)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)]';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors shadow-xs ${baseStyle} ${className}`}
      >
        <CalendarCheck className="w-4 h-4 text-emerald-500" />
        <span>Bulk Mark Attendance</span>
      </button>
      {open && (
        <BulkMarkAttendanceModal
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
