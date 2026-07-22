import { Suspense } from 'react';
import RecordLeaveForm from './RecordLeaveForm';

export default function RecordLeavePage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Record Leave</h1>
        <a href="/leave/admin" className="text-xs text-slate-400 hover:text-white">← Back to balances</a>
      </div>
      {/* Suspense boundary required by Next.js because RecordLeaveForm now
          calls useSearchParams() (D1-3: preselect employee from ?employee=). */}
      <Suspense fallback={null}>
        <RecordLeaveForm />
      </Suspense>
    </div>
  );
}