import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Loader2, PackagePlus, RefreshCw } from 'lucide-react';
import {
  ProductWorkspaceActivity,
  ProductWorkspaceBranchStock,
  ProductWorkspacePayload,
} from '../../types';
import { adminFetch } from '../../api/adminFetch';
import ProductAvailabilitySummary from './ProductAvailabilitySummary.tsx';
import ProductBranchDistribution from './ProductBranchDistribution.tsx';
import ProductDistributionPanel from './ProductDistributionPanel.tsx';
import ProductInventoryHeader from './ProductInventoryHeader.tsx';
import ProductReceivePanel from './ProductReceivePanel.tsx';
import ProductInventoryDetails from './ProductInventoryDetails';
import ProductWorkspaceAction from './ProductWorkspaceAction';
import { workspaceFocus, workspaceStyles } from './productWorkspaceStyles';

interface ProductInventoryWorkspaceProps {
  productId: number;
  refreshToken: number;
  isDarkMode: boolean;
  onBack: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';

const ProductInventoryWorkspace: React.FC<ProductInventoryWorkspaceProps> = ({
  productId,
  refreshToken,
  isDarkMode,
  onBack,
}) => {
  const [workspace, setWorkspace] = useState<ProductWorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const tone = workspaceStyles(isDarkMode);

  const loadWorkspace = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await adminFetch(`${API_BASE}/api/admin/products/${productId}/workspace`, {
        headers: {
          Accept: 'application/json',
        },
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'فشل تحميل مساحة المنتج');
      }

      setWorkspace(data);
    } catch (fetchError: any) {
      setError(fetchError.message || 'حدث خطأ أثناء تحميل مساحة المنتج');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, [productId]);

  useEffect(() => {
    if (refreshToken <= 0) return;
    loadWorkspace();
  }, [refreshToken]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const filteredActivities = useMemo<ProductWorkspaceActivity[]>(() => {
    if (!workspace) return [];
    if (selectedBranchId === null) return workspace.recent_activity;
    return workspace.recent_activity.filter((activity) => activity.branch_id === selectedBranchId);
  }, [selectedBranchId, workspace]);

  const visibleBranches = useMemo<ProductWorkspaceBranchStock[]>(() => {
    return [...(workspace?.branch_distribution || [])].sort((a, b) => {
      if (a.is_main_warehouse) return -1;
      if (b.is_main_warehouse) return 1;
      return a.branch_name.localeCompare(b.branch_name, 'ar');
    });
  }, [workspace]);

  const mainStore = useMemo<ProductWorkspaceBranchStock | null>(() => {
    return visibleBranches.find((branch) => branch.is_main_warehouse) || null;
  }, [visibleBranches]);

  const handleReceive = async (payload: { branch_id: number; quantity: number; notes: string }) => {
    setSubmitting(true);

    try {
      const response = await adminFetch(`${API_BASE}/api/admin/products/${productId}/stock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          branch_id: payload.branch_id,
          quantity: payload.quantity,
          movement_type: 'SUPPLY_IN',
          notes: payload.notes || null,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'فشل تنفيذ التوريد');
      }

      await loadWorkspace();
      setSelectedBranchId(payload.branch_id);
      setToast({ type: 'success', message: 'تم توريد الكمية إلى المخزن الرئيسي.' });
    } catch (submitError: any) {
      setToast({ type: 'error', message: submitError.message || 'تعذر حفظ عملية التوريد.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDistribute = async (payload: { branch_id: number; quantity: number; notes: string }) => {
    if (!mainStore) {
      setToast({ type: 'error', message: 'تعذر تحديد المخزن الرئيسي.' });
      return;
    }

    setSubmitting(true);

    try {
      const response = await adminFetch(`${API_BASE}/api/admin/products/${productId}/stock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          branch_id: payload.branch_id,
          source_branch_id: mainStore.branch_id,
          quantity: payload.quantity,
          movement_type: 'TRANSFER_IN',
          notes: payload.notes || null,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'فشل تنفيذ التوزيع');
      }

      await loadWorkspace();
      setSelectedBranchId(payload.branch_id);
      setToast({ type: 'success', message: data.message || 'تم إرسال الشحنة إلى الفرع.' });
    } catch (submitError: any) {
      setToast({ type: 'error', message: submitError.message || 'تعذر حفظ عملية التوزيع.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div role="status" className={`flex min-h-[40vh] flex-col items-center justify-center gap-3 ${tone.panel}`}>
        <Loader2 size={28} aria-hidden="true" className={`animate-spin ${tone.muted}`} />
        <p className={`text-sm ${tone.muted}`}>
          جاري تحميل مساحة المنتج
        </p>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className={`${tone.panel} p-6 text-center`}>
        <AlertTriangle size={28} aria-hidden="true" className="mx-auto text-[#E53935]" />
        <p role="alert" className="mt-3 text-sm font-bold">{error || 'تعذر تحميل بيانات المنتج'}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={loadWorkspace}
            className={tone.button}
          >
            <RefreshCw size={14} aria-hidden="true" />
            إعادة المحاولة
          </button>
          <button
            type="button"
            onClick={onBack}
            className={`min-h-11 rounded-xl bg-[#c82e2b] px-4 py-2 text-xs font-bold text-white ${workspaceFocus}`}
          >
            العودة
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4 animate-fade-in-up">
      {toast && (
        <div className="fixed bottom-4 left-4 right-4 z-[110] sm:left-8 sm:right-auto sm:max-w-md">
          <div role={toast.type === 'error' ? 'alert' : 'status'} className={`${tone.panel} px-4 py-3 text-xs font-bold shadow-2xl`}>
            <span className={toast.type === 'success' ? (isDarkMode ? 'text-emerald-300' : 'text-emerald-800') : (isDarkMode ? 'text-red-300' : 'text-red-800')}>{toast.message}</span>
          </div>
        </div>
      )}

      <ProductInventoryHeader product={workspace.product} onBack={onBack} isDarkMode={isDarkMode} />

      <ProductAvailabilitySummary
        summary={workspace.summary}
        branchQuantity={visibleBranches.filter((branch) => !branch.is_main_warehouse).reduce((quantity, branch) => quantity + branch.stock_quantity, 0)}
        unit={workspace.product.unit}
        isDarkMode={isDarkMode}
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ProductBranchDistribution
          branches={visibleBranches}
          selectedBranchId={selectedBranchId}
          unit={workspace.product.unit}
          onSelectBranch={setSelectedBranchId}
          isDarkMode={isDarkMode}
        />

        <div className="min-w-0 space-y-3">
          <ProductWorkspaceAction
            title="توريد مخزون"
            description="إضافة كمية إلى المخزن الرئيسي"
            icon={<PackagePlus size={18} aria-hidden="true" />}
            isDarkMode={isDarkMode}
          >
            <ProductReceivePanel
              branches={visibleBranches}
              unit={workspace.product.unit}
              submitting={submitting}
              onReceive={handleReceive}
              isDarkMode={isDarkMode}
            />
          </ProductWorkspaceAction>

          <ProductWorkspaceAction
            title="توزيع مخزون"
            description="إرسال شحنة من المخزن الرئيسي إلى فرع"
            icon={<ArrowLeftRight size={18} aria-hidden="true" />}
            isDarkMode={isDarkMode}
          >
            <ProductDistributionPanel
              branches={visibleBranches}
              unit={workspace.product.unit}
              submitting={submitting}
              onDistribute={handleDistribute}
              isDarkMode={isDarkMode}
            />
          </ProductWorkspaceAction>
        </div>
      </div>

      <ProductInventoryDetails
        productId={productId}
        onSelectBranch={setSelectedBranchId}
        activities={filteredActivities}
        batches={workspace.batches || []}
        activeBranchId={selectedBranchId}
        unit={workspace.product.unit}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};

export default ProductInventoryWorkspace;
