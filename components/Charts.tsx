// Barrel re-export — chart components have been modularized into components/charts/*.
// All existing imports from '@/components/Charts' continue to work unchanged.

export { DailyTrendChart, ComparisonTrendChart } from './charts/TrendCharts';
export { DeptAttendanceChart, OfficeAttendanceChart, DeptProductivityChart } from './charts/DeptCharts';
export { HoursDistributionChart } from './charts/HoursDistributionChart';
export { PersonalHeatmap, AttendanceHeatmap, STATUS_COLORS_CELL, getCellStatus } from './charts/HeatmapCharts';
export { DayDeptAttendanceChart, DayDeptLateChart, DayDeptProductivityChart } from './charts/DayCharts';