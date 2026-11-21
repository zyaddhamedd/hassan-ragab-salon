import React, { useEffect, useMemo, useState } from 'react';
import { Filter, PanelRightOpen } from 'lucide-react';
import SupplyWorkspacePanel from './SupplyWorkspacePanel.tsx';
import { SupplyWorkspaceBranchOption, buildSupplyWorkspaceSummary, countActiveSupplyWorkspaceFilters, validateSupplyWorkspaceFilters } from './supplyWorkspaceFilters.ts';
import { SupplyWorkspaceState, SupplyWorkspaceTab, SUPPLY_WORKSPACE_SECTION_LABELS } from './supplyWorkspaceTypes.ts';

interface SupplyWorkspaceControlsProps {
  branchLocked?: boolean;
  activeTab: SupplyWorkspaceTab;
  appliedState: SupplyWorkspaceState;
  branchOptions: SupplyWorkspaceBranchOption[];
  isDarkMode: boolean;
  onApply: (nextState: SupplyWorkspaceState) => boolean;
  onReset: () => void;
}

const controlsTransition = '240ms cubic-bezier(0.22, 1, 0.36, 1)';

const SupplyWorkspaceControls: React.FC<SupplyWorkspaceControlsProps> = ({
  branchLocked = false,
  activeTab,
  appliedState,
  branchOptions,
  isDarkMode,
  onApply,
  onReset,
}) => {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [draftState, setDraftState] = useState<SupplyWorkspaceState>(appliedState);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const isVisible = activeTab !== 'catalog';
  const activeFilterCount = useMemo(() => countActiveSupplyWorkspaceFilters(appliedState), [appliedState]);
  const summary = useMemo(() => buildSupplyWorkspaceSummary(appliedState, branchOptions), [appliedState, branchOptions]);
  const canApply = useMemo(() => JSON.stringify(draftState) !== JSON.stringify(appliedState), [appliedState, draftState]);

  useEffect(() => {
    if (!isPanelOpen) {
      setDraftState(appliedState);
      setValidationMessage(null);
    }
  }, [appliedState, isPanelOpen]);

  useEffect(() => {
    if (!isPanelOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isPanelOpen]);

  useEffect(() => {
    if (isVisible) return;
    setIsPanelOpen(false);
  }, [isVisible]);

  const openPanel = () => {
    setDraftState(appliedState);
    setValidationMessage(null);
    setIsPanelOpen(true);
  };

  const handleApply = () => {
    const validation = validateSupplyWorkspaceFilters(draftState);
    if (!validation.isValid) {
      setValidationMessage(validation.message);
      return;
    }
    if (branchLocked && draftState.datePreset === 'custom' &&
        (Date.parse(draftState.dateTo) - Date.parse(draftState.dateFrom)) / 86400000 > 365) {
      setValidationMessage('اختر فترة لا تزيد عن 366 يوم.');
      return;
    }

    setValidationMessage(null);
    const didApply = onApply(draftState);
    if (didApply) {
      setIsPanelOpen(false);
    }
  };

  const handleReset = () => {
    setValidationMessage(null);
    setDraftState(appliedState);
    onReset();
    setIsPanelOpen(false);
  };

  return (
    <>
      <div
        className={`sticky z-30 flex w-full justify-end overflow-hidden transition-all duration-300 ${
          isVisible
            ? 'pointer-events-auto top-4 mb-4 max-h-24 opacity-100 sm:top-5'
            : 'pointer-events-none top-0 mb-0 max-h-0 opacity-0'
        }`}
        dir="rtl"
      >
        <button
          type="button"
          onClick={openPanel}
          aria-label="فتح أدوات العرض"
          className={`group inline-flex items-center gap-3 overflow-hidden rounded-[1.45rem] border px-3 py-2 text-right backdrop-blur-md transition-all ${
            isDarkMode
              ? 'border-white/[0.08] bg-[#101114]/80 text-white hover:border-white/[0.14] hover:bg-[#14161a]/88'
              : 'border-black/[0.08] bg-white/84 text-[#121212] hover:border-black/[0.14] hover:bg-white/92'
          }`}
          style={{
            boxShadow: isDarkMode
              ? '0 14px 28px -24px rgba(0, 0, 0, 0.72)'
              : '0 14px 28px -24px rgba(15, 23, 42, 0.18)',
            transform: isPanelOpen ? 'translateY(-1px)' : 'translateY(0)',
            transition: `transform ${controlsTransition}, border-color ${controlsTransition}, background-color ${controlsTransition}, box-shadow ${controlsTransition}`,
          }}
        >
          <div className="min-w-0">
            <div className="flex items-center justify-end gap-1.5">
              <PanelRightOpen size={12} className={isDarkMode ? 'text-white/34' : 'text-black/36'} />
              <p className={`text-[10px] font-semibold ${isDarkMode ? 'text-white/46' : 'text-black/46'}`}>
                {SUPPLY_WORKSPACE_SECTION_LABELS[activeTab]}
              </p>
            </div>
            <p className={`mt-1 truncate text-[12px] font-semibold ${isDarkMode ? 'text-white/94' : 'text-[#121212]'}`}>
              {summary}
            </p>
          </div>

          <div
            className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[1rem] border transition-all ${
              isDarkMode
                ? 'border-white/[0.08] bg-white/[0.04] text-white/82'
                : 'border-black/[0.08] bg-black/[0.03] text-black/74'
            }`}
          >
            <Filter size={14} />
            {activeFilterCount > 0 && (
              <span
                className={`absolute -left-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[9px] font-bold ${
                  isDarkMode ? 'bg-white text-[#111214]' : 'bg-[#121212] text-white'
                }`}
              >
                {activeFilterCount}
              </span>
            )}
          </div>
        </button>
      </div>

      <SupplyWorkspacePanel
        branchLocked={branchLocked}
        activeTab={activeTab}
        branchOptions={branchOptions}
        canApply={canApply}
        draftState={draftState}
        isDarkMode={isDarkMode}
        isOpen={isPanelOpen}
        onApply={handleApply}
        onClose={() => setIsPanelOpen(false)}
        onReset={handleReset}
        onStateChange={(nextState) => {
          setValidationMessage(null);
          setDraftState(nextState);
        }}
        validationMessage={validationMessage}
      />
    </>
  );
};

export default SupplyWorkspaceControls;
