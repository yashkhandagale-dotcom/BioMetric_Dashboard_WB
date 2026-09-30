import DashboardSkeleton from '@/components/dashboard/DashboardSkeleton';

export default function Loading() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto min-h-screen">
      <DashboardSkeleton />
    </div>
  );
}
