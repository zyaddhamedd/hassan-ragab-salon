import React from 'react';
import { CalendarRange, ChevronDown, PanelRightClose } from 'lucide-react';
import {
  SUPPLY_WORKSPACE_DATE_PRESET_OPTIONS,
  SUPPLY_WORKSPACE_SECTION_LABELS,
  SupplyWorkspaceDatePreset,
  SupplyWorkspaceState,
  SupplyWorkspaceTab,
} from './supplyWorkspaceTypes.ts';
import { SupplyWorkspaceBranchOption } from './supplyWorkspaceFilters.ts';

interface SupplyWorkspacePanelProps {
  branchLocked?: boolean;
  activeTab: SupplyWorkspaceTab;
  branchOptions: SupplyWorkspaceBranchOption[];
  canApply: boolean;
  draftState: SupplyWorkspaceState;
  isDarkMode: boolean;
  isOpen: boolean;
  onApply: () => void;
  onClose: () => void;
  onReset: () => void;
  onStateChange: (nextState: SupplyWorkspaceState) => void;
  validationMessage?: string | null;
}

const panelTransition = '320ms cubic-bezier(0.22, 1, 0.36, 1)';

const fieldShell = (isDarkMode: boolean) =>
  `relative overflow-hidden rounded-[1.35rem] border px-4 py-3.5 transition-all duration-300 ${
    isDarkMode
      ? 'border-white/[0.07] bg-[#111216]/84 text-white'
      : 'border-black/[0.07] bg-white/92 text-[#121212] shadow-[0_10px_30px_-24px_rgba(0,0,0,0.3)]'
  }`;

const fieldLabelClass = (isDarkMode: boolean) =>
  `mb-2 block text-[11px] font-bold tracking-[0.02em] ${isDarkMode ? 'text-white/55' : 'text-black/52'}`;

const selectClass = (isDarkMode: boolean) =>
  `h-9 w-full appearance-none bg-transparent pl-0 pr-7 text-right text-[14px] font-semibold outline-none ${
    isDarkMode ? 'text-white' : 'text-[#111214]'
  }`;

const inputClass = (isDarkMode: boolean) =>
  `h-10 w-full rounded-[1rem] border px-3 text-sm font-semibold outline-none transition-all ${
    isDarkMode
      ? 'border-white/[0.08] bg-white/[0.03] text-white [color-scheme:dark] focus:border-white/[0.16]'
      : 'border-black/[0.08] bg-black/[0.02] text-[#111214] focus:border-black/[0.16]'
  }`;

const selectOptionStyle = (isDarkMode: boolean) => ({
  backgroundColor: isDarkMode ? '#111216' : '#ffffff',
  color: isDarkMode ? '#f4f5f7' : '#111214',
});

const SupplyWorkspacePanel: React.FC<SupplyWorkspacePanelProps> = ({
  branchLocked = false,
  activeTab,
  branchOptions,
  canApply,
  draftState,
  isDarkMode,
  isOpen,
  onApply,
  onClose,
  onReset,
  onStateChange,
  validationMessage,
}) => {
  const updateState = <K extends keyof SupplyWorkspaceState>(key: K, value: SupplyWorkspaceState[K]) => {
    onStateChange({
      ...draftState,
      [key]: value,
    });
  };

  const handlePresetChange = (preset: SupplyWorkspaceDatePreset) => {
    onStateChange({
      ...draftState,
      datePreset: preset,
      ...(preset !== 'custom' ? { dateFrom: '', dateTo: '' } : {}),
    });
  };

  return (
    <div
      className={`pointer-events-none fixed inset-[var(--app-header-height)_0_0_0] z-[90] lg:right-[var(--app-sidebar-offset)] ${
        isOpen ? 'visible' : 'invisible'
      }`}
      dir="rtl"
    >
      <div
        className={`absolute inset-0 transition-all duration-300 ${
          isOpen ? 'pointer-events-auto bg-black/20 backdrop-blur-[2px]' : 'bg-transparent backdrop-blur-0'
        }`}
        onClick={onClose}
        style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
      />

      <aside
        className={`pointer-events-auto absolute inset-y-4 right-4 flex w-[min(396px,calc(100vw-1.5rem))] origin-right flex-col overflow-hidden rounded-[1.75rem] border transition-all ${
          isDarkMode
            ? 'border-white/[0.08] bg-[#0c0d10]/90 text-white'
            : 'border-black/[0.08] bg-[rgba(255,255,255,0.92)] text-[#121212]'
        }`}
        style={{
          backdropFilter: isOpen ? 'blur(18px)' : 'blur(0px)',
          boxShadow: isDarkMode
            ? '0 26px 60px -42px rgba(0, 0, 0, 0.82)'
            : '0 22px 48px -34px rgba(15, 23, 42, 0.2)',
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? 'translateX(0) scale(1)' : 'translateX(16px) scale(0.985)',
          transition: `transform ${panelTransition}, opacity ${panelTransition}, backdrop-filter ${panelTransition}`,
        }}
      >
        <div
          className={`relative shrink-0 border-b px-5 py-3.5 text-right ${
            isDarkMode ? 'border-white/[0.06]' : 'border-black/[0.06]'
          }`}
        >
          <div className="absolute left-0 top-0 h-24 w-24 -translate-x-1/4 -translate-y-1/3 rounded-full bg-white/[0.03] blur-3xl" />

          <button
            type="button"
            onClick={onClose}
            className={`absolute left-4 top-3 inline-flex h-9 w-9 items-center justify-center rounded-[1rem] border transition-all ${
              isDarkMode
                ? 'border-white/[0.08] bg-white/[0.03] text-white/70 hover:bg-white/[0.06] hover:text-white'
                : 'border-black/[0.08] bg-black/[0.03] text-black/56 hover:bg-black/[0.05] hover:text-black'
            }`}
            aria-label="إغلاق أدوات العرض"
          >
            <PanelRightClose size={15} />
          </button>

          <div className="ml-12">
            <h2 className="text-[22px] font-black leading-none tracking-tight">أدوات العرض</h2>
            <p className={`mt-2 truncate text-[13px] leading-5 ${isDarkMode ? 'text-white/58' : 'text-black/52'}`}>
              تحكم في الفرع والتاريخ
            </p>

            <div
              className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                isDarkMode
                  ? 'border-white/[0.07] bg-white/[0.03] text-white/68'
                  : 'border-black/[0.07] bg-black/[0.03] text-black/62'
              }`}
            >
              <CalendarRange size={11} />
              <span>{SUPPLY_WORKSPACE_SECTION_LABELS[activeTab]}</span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-3.5 text-right">
            <section className={fieldShell(isDarkMode)}>
              <label className={fieldLabelClass(isDarkMode)}>الفرع</label>
              {branchLocked ? <p className="text-xs leading-relaxed">{branchOptions.find(option => option.value === draftState.branch)?.label || `موقع #${draftState.branch}`}<span className="mt-1 block opacity-60">مرتبط بمحدد الفرع الرئيسي وأزرار المواقع. التواريخ بتوقيت القاهرة.</span></p> : <div className="relative">
                <select
                  value={draftState.branch}
                  onChange={(event) => updateState('branch', event.target.value as SupplyWorkspaceState['branch'])}
                  className={selectClass(isDarkMode)}
                  style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                >
                  {branchOptions.map((option) => (
                    <option key={option.value} value={option.value} style={selectOptionStyle(isDarkMode)}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={15}
                  className={`pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 ${
                    isDarkMode ? 'text-white/78' : 'text-black/68'
                  }`}
                />
              </div>}
            </section>

            <section className={fieldShell(isDarkMode)}>
              <label className={fieldLabelClass(isDarkMode)}>التاريخ</label>
              <div className="grid grid-cols-2 gap-2">
                {SUPPLY_WORKSPACE_DATE_PRESET_OPTIONS.map((option) => {
                  const isActive = draftState.datePreset === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handlePresetChange(option.value)}
                      className={`rounded-[1rem] border px-3 py-2.5 text-right text-[12px] font-semibold transition-all ${
                        isActive
                          ? isDarkMode
                            ? 'border-white/[0.16] bg-white/[0.09] text-white'
                            : 'border-black/[0.14] bg-black/[0.06] text-[#121212]'
                          : isDarkMode
                            ? 'border-white/[0.05] bg-black/10 text-white/72 hover:border-white/[0.1] hover:text-white'
                            : 'border-black/[0.05] bg-black/[0.015] text-black/68 hover:border-black/[0.1] hover:text-black'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div
                className="grid overflow-hidden transition-all duration-300"
                style={{
                  gridTemplateRows: draftState.datePreset === 'custom' ? '1fr' : '0fr',
                  opacity: draftState.datePreset === 'custom' ? 1 : 0,
                  marginTop: draftState.datePreset === 'custom' ? '12px' : '0px',
                }}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className={`mb-1.5 block text-[11px] font-semibold ${isDarkMode ? 'text-white/52' : 'text-black/50'}`}>
                        من
                      </label>
                      <input
                        type="date"
                        value={draftState.dateFrom}
                        onChange={(event) => updateState('dateFrom', event.target.value)}
                        className={inputClass(isDarkMode)}
                      />
                    </div>
                    <div>
                      <label className={`mb-1.5 block text-[11px] font-semibold ${isDarkMode ? 'text-white/52' : 'text-black/50'}`}>
                        إلى
                      </label>
                      <input
                        type="date"
                        value={draftState.dateTo}
                        onChange={(event) => updateState('dateTo', event.target.value)}
                        className={inputClass(isDarkMode)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div
          className={`shrink-0 border-t px-5 py-3 backdrop-blur-md ${
            isDarkMode ? 'border-white/[0.06] bg-[#0d0f12]/94' : 'border-black/[0.06] bg-white/92'
          }`}
        >
          {validationMessage ? (
            <div className="mb-2 rounded-2xl border border-[#E53935]/15 bg-[#E53935]/6 px-3 py-2 text-right text-[11px] font-semibold text-[#ffb8b4]">
              {validationMessage}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onReset}
              className={`inline-flex h-10 items-center justify-center rounded-[1rem] border px-4 text-sm font-semibold transition-all ${
                isDarkMode
                  ? 'border-white/[0.08] bg-white/[0.03] text-white/74 hover:bg-white/[0.05] hover:text-white'
                  : 'border-black/[0.08] bg-black/[0.03] text-black/72 hover:bg-black/[0.05] hover:text-black'
              }`}
            >
              إعادة ضبط
            </button>

            <button
              type="button"
              onClick={onApply}
              disabled={!canApply}
              className={`inline-flex h-10 min-w-[118px] items-center justify-center rounded-[1rem] px-5 text-sm font-semibold transition-all ${
                canApply
                  ? isDarkMode
                    ? 'bg-white text-[#111214] hover:bg-white/92'
                    : 'bg-[#121212] text-white hover:bg-black'
                  : isDarkMode
                    ? 'cursor-not-allowed bg-white/[0.08] text-white/30'
                    : 'cursor-not-allowed bg-black/[0.08] text-black/28'
              }`}
            >
              تطبيق
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default SupplyWorkspacePanel;
