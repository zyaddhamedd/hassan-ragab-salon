import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import SupplyOverview from './supply/SupplyOverview';
import ProductCatalog from './supply/ProductCatalog.tsx';
import ProductInventoryWorkspace from './supply/ProductInventoryWorkspace.tsx';
import BulkTransferModal from './supply/BulkTransferModal.tsx';
import ReceiveSupplyModal from './supply/ReceiveSupplyModal.tsx';
import ShipmentDetailsModal from './supply/ShipmentDetailsModal.tsx';
import ShipmentHistoryTab from './supply/ShipmentHistoryTab.tsx';
import BranchRequestsTab from './supply/BranchRequestsTab.tsx';
import ReturnsTab from './supply/ReturnsTab.tsx';
import SupplyWorkspaceControls from './supply/SupplyWorkspaceControls.tsx';
import { buildSupplyWorkspaceBranchOptions } from './supply/supplyWorkspaceFilters.ts';
import { SUPPLY_WORKSPACE_DEFAULT_STATE, SupplyWorkspaceState } from './supply/supplyWorkspaceTypes.ts';
import { Branch } from '../types';
import { adminFetch } from '../api/adminFetch';
import useSupplyCatalogNavigation from '../hooks/useSupplyCatalogNavigation';

interface InventoryPageProps {
  isDarkMode: boolean;
  selectedBranch: string;
  navigation: ReturnType<typeof useSupplyCatalogNavigation>;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

const InventoryPage: React.FC<InventoryPageProps> = ({ isDarkMode, selectedBranch: globalBranch, navigation }) => {
  const activeSubTab = navigation.state.tab;
  const setActiveSubTab = (tab: typeof activeSubTab) => navigation.selectTab(tab, globalBranch);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const selectedProductId = navigation.state.productId;
  const [inventoryDataVersion, setInventoryDataVersion] = useState(0);
  const [selectedShipmentId, setSelectedShipmentId] = useState<number | null>(null);
  const [isBulkTransferOpen, setIsBulkTransferOpen] = useState(false);
  const [isReceiveSupplyOpen, setIsReceiveSupplyOpen] = useState(false);
  const [workspaceBranches, setWorkspaceBranches] = useState<Branch[]>([]);
  const [pendingReturnsCount, setPendingReturnsCount] = useState(0);
  const [appliedWorkspaceFilters, setAppliedWorkspaceFilters] = useState<SupplyWorkspaceState>(SUPPLY_WORKSPACE_DEFAULT_STATE);


  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const workspaceBranchOptions = useMemo(
    () => buildSupplyWorkspaceBranchOptions(workspaceBranches), [workspaceBranches],
  );
  // Overview shares the global branch selector. Other tabs retain their own
  // existing workspace filter behavior.
  const overviewBranch = (!globalBranch || globalBranch.toLowerCase() === 'all') ? 'all' : globalBranch;
  const effectiveFilters = activeSubTab === 'overview'
    ? { ...appliedWorkspaceFilters, branch: overviewBranch as SupplyWorkspaceState['branch'] }
    : appliedWorkspaceFilters;
  const overviewBranchOptions = [
    { value: 'all' as const, label: 'كل الفروع' },
    ...workspaceBranches.map(branch => ({
      value: String(branch.id) as SupplyWorkspaceState['branch'],
      label: `${branch.name}${branch.is_active === false ? ' (غير نشط)' : ''}`,
    })),
  ];
  if (overviewBranch !== 'all' && !overviewBranchOptions.some(option => option.value === overviewBranch)) {
    overviewBranchOptions.push({ value: overviewBranch as SupplyWorkspaceState['branch'], label: `موقع #${overviewBranch}` });
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    Promise.all([
      adminFetch(`${API_BASE}/api/admin/branches`, { signal: controller.signal }),
      adminFetch(`${API_BASE}/api/admin/inventory/overview-summary`, { signal: controller.signal }),
    ]).then(async ([branches, summary]) => {
      if (!branches.ok || !summary.ok) throw new Error('تعذر تحميل بيانات التنقل في مركز الإمداد.');
      const [list, counts] = await Promise.all([branches.json(), summary.json()]);
      if (!active) return;
      setWorkspaceBranches(Array.isArray(list) ? list : []);
      setPendingReturnsCount(Number(counts.pending_returns || 0));
    }).catch(error => { if (active && error.name !== 'AbortError') setToastMessage(error.message); });
    return () => { active = false; controller.abort(); };
  }, [inventoryDataVersion]);

  const handleTransferSuccess = (message: string) => {
    setInventoryDataVersion(current => current + 1);
    setToastMessage(message);
  };

  const handleApplyWorkspaceFilters = (nextState: SupplyWorkspaceState) => {
    if (JSON.stringify(nextState) === JSON.stringify(appliedWorkspaceFilters)) {
      return false;
    }

    setAppliedWorkspaceFilters(nextState);
    return true;
  };

  const handleResetWorkspaceFilters = () => {
    if (JSON.stringify(appliedWorkspaceFilters) === JSON.stringify(SUPPLY_WORKSPACE_DEFAULT_STATE)) {
      return;
    }

    setAppliedWorkspaceFilters(SUPPLY_WORKSPACE_DEFAULT_STATE);
  };

  return (
    <div className="admin-page-shell relative z-10 animate-fade-in-up lg:px-8">
      {toastMessage && (
        <div className="fixed bottom-8 left-8 z-[100] animate-toast-in">
          <div
            className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-md ${
              isDarkMode ? 'border-white/10 bg-[#161618] text-white' : 'border-black/10 bg-white text-gray-900'
            }`}
          >
            <CheckCircle2 size={15} className="text-[#E6D690]" />
            <span className="text-[11px] font-semibold">{toastMessage}</span>
          </div>
        </div>
      )}

      <nav aria-label="أقسام مركز الإمداد" dir="rtl" className={`mb-4 flex overflow-x-auto border-b ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}>
        {([
          ['overview', 'نظرة عامة على مركز الإمداد'], ['catalog', 'كتالوج ودليل المنتجات'],
          ['history', 'سجل الشحنات'], ['requests', 'طلبات الفروع'], ['returns', 'المرتجعات'],
        ] as const).map(([tab, label]) => <button
          key={tab} type="button" onClick={() => setActiveSubTab(tab)} aria-current={activeSubTab === tab ? 'page' : undefined}
          className={`relative shrink-0 border-b-2 px-4 py-3 text-sm font-semibold ${activeSubTab === tab ? `border-red-500 ${isDarkMode ? 'text-white' : 'text-gray-900'}` : 'border-transparent text-gray-500'}`}
        >{label}{tab === 'returns' && pendingReturnsCount > 0 && <span title="طلبات معلقة ضمن نطاق العرض الحالي للمرتجعات" className="mr-2 rounded-full bg-amber-500/15 px-2 text-xs">{pendingReturnsCount}</span>}</button>)}
      </nav>

      <SupplyWorkspaceControls
        activeTab={activeSubTab}
        appliedState={effectiveFilters}
        branchLocked={activeSubTab === 'overview'}
        branchOptions={activeSubTab === 'overview' ? overviewBranchOptions : workspaceBranchOptions}
        isDarkMode={isDarkMode}
        onApply={handleApplyWorkspaceFilters}
        onReset={handleResetWorkspaceFilters}
      />

      {activeSubTab === 'overview' && (
        <SupplyOverview
          isDarkMode={isDarkMode} filters={effectiveFilters} version={inventoryDataVersion}
          onSelectBranch={id => navigation.selectTab('overview', id === 'all' ? 'All' : id)}
          onOpenShipment={setSelectedShipmentId}
          onReceive={() => setIsReceiveSupplyOpen(true)} onTransfer={() => setIsBulkTransferOpen(true)}
        />
      )}

      {activeSubTab === 'catalog' &&
        (selectedProductId ? (
          <ProductInventoryWorkspace
            key={selectedProductId}
            productId={selectedProductId}
            refreshToken={inventoryDataVersion}
            isDarkMode={isDarkMode}
            onBack={navigation.closeProduct}
          />
        ) : (
          <ProductCatalog
            isDarkMode={isDarkMode}
            selectedBranch={globalBranch}
            refreshToken={inventoryDataVersion}
            onOpenWorkspace={navigation.openProduct}
            query={navigation.state.catalog}
            onQueryChange={navigation.updateCatalog}
          />
        ))}

      {activeSubTab === 'history' && (
        <ShipmentHistoryTab
          filters={appliedWorkspaceFilters}
          refreshToken={inventoryDataVersion}
          onOpenShipment={setSelectedShipmentId}
        />
      )}

      {activeSubTab === 'requests' && (
        <BranchRequestsTab
          filters={appliedWorkspaceFilters}
          isDarkMode={isDarkMode}
        />
      )}

      {activeSubTab === 'returns' && (
        <ReturnsTab
          filters={appliedWorkspaceFilters}
          isDarkMode={isDarkMode}
          onPendingCountChange={setPendingReturnsCount}
          onResolved={() => {
            setInventoryDataVersion((current) => current + 1);
          }}
        />
      )}

      <BulkTransferModal
        isOpen={isBulkTransferOpen}
        onClose={() => setIsBulkTransferOpen(false)}
        onSuccess={handleTransferSuccess}
      />

      <ReceiveSupplyModal
        isOpen={isReceiveSupplyOpen}
        onClose={() => setIsReceiveSupplyOpen(false)}
        onSuccess={handleTransferSuccess}
      />

      <ShipmentDetailsModal
        shipmentId={selectedShipmentId}
        isOpen={selectedShipmentId !== null}
        onClose={() => setSelectedShipmentId(null)}
        onCancelled={handleTransferSuccess}
      />
    </div>
  );
};

export default InventoryPage;
