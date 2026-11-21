import React, { useState } from 'react';
import useSupplyOverviewRead from '../../hooks/useSupplyOverviewRead';
import OperationalPipeline from './OperationalPipeline';
import BranchComparison from './BranchComparison';
import RecentActivity from './RecentActivity';
import QuickActions from './QuickActions';
import { overviewDates } from './overviewDates';
import { SupplyWorkspaceState } from './supplyWorkspaceTypes';
import { SupplyOverviewData, overviewControl } from './supplyOverviewTypes';

interface Props {
  isDarkMode: boolean; filters: SupplyWorkspaceState; version: number;
  onSelectBranch: (id: string) => void;
  onOpenShipment: (id: number) => void; onReceive: () => void; onTransfer: () => void;
}
const SupplyOverview: React.FC<Props> = ({ isDarkMode, filters, version, onSelectBranch, onOpenShipment, onReceive, onTransfer }) => {
  const [refresh, setRefresh] = useState(0);
  const range = overviewDates(filters);
  const query = new URLSearchParams({ branch_id: filters.branch, date_from: range.dateFrom, date_to: range.dateTo }).toString();
  const result = useSupplyOverviewRead<SupplyOverviewData>(`overview?${query}`, version + refresh);
  return <div dir="rtl" className={`space-y-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs"><p className="font-semibold">مركز الإمداد</p><p className="mt-1 opacity-60">فترة التقرير: {range.dateFrom} إلى {range.dateTo} • بتوقيت القاهرة</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={overviewControl(isDarkMode)} onClick={() => setRefresh(v => v + 1)}>تحديث</button><QuickActions isDarkMode={isDarkMode} onReceiveShipment={onReceive} onNewTransfer={onTransfer} /></div>
    </div>
    {result.loading && <p role="status" className="py-8 text-center text-xs">جاري تحميل ملخص الإمداد…</p>}
    {result.error && <p role="alert" className="rounded-xl border border-red-500/30 p-3 text-sm">{result.error}</p>}
    {result.data && <>
      <OperationalPipeline data={result.data} isDarkMode={isDarkMode} branchId={filters.branch} onSelectBranch={onSelectBranch}>
        <RecentActivity activity={result.data.activity} period={result.data.period} isDarkMode={isDarkMode} onOpenShipment={onOpenShipment} />
      </OperationalPipeline>
    </>}
    <BranchComparison key={query} query={query} isDarkMode={isDarkMode} version={version + refresh} />
  </div>;
};
export default SupplyOverview;
