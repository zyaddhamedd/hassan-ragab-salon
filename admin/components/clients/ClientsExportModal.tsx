import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw, X } from 'lucide-react';

export interface ClientsExportColumnOption {
  id: string;
  label: string;
}

interface ClientsExportModalProps {
  isOpen: boolean;
  isDarkMode: boolean;
  matchingCount: number;
  columns: ClientsExportColumnOption[];
  defaultSelectedColumnIds: string[];
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (selectedColumnIds: string[]) => void;
}

const ClientsExportModal: React.FC<ClientsExportModalProps> = ({
  isOpen,
  isDarkMode,
  matchingCount,
  columns,
  defaultSelectedColumnIds,
  isSubmitting,
  onClose,
  onConfirm
}) => {
  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>(defaultSelectedColumnIds);

  useEffect(() => {
    if (isOpen) {
      setSelectedColumnIds(defaultSelectedColumnIds);
    }
  }, [defaultSelectedColumnIds, isOpen]);

  if (!isOpen) {
    return null;
  }

  const toggleColumn = (columnId: string) => {
    if (isSubmitting) {
      return;
    }

    setSelectedColumnIds((current) => {
      if (current.includes(columnId)) {
        if (current.length === 1) {
          return current;
        }

        return current.filter((value) => value !== columnId);
      }

      return [...current, columnId];
    });
  };

  return (
    <div className="admin-overlay-shell admin-overlay-shell--scroll z-[140] bg-black/65 backdrop-blur-sm" dir="rtl">
      <div
        className="absolute inset-0"
        onClick={() => {
          if (!isSubmitting) {
            onClose();
          }
        }}
      />

      <div
        className={`admin-overlay-panel relative my-auto w-full max-w-xl rounded-[2rem] border animate-scale-in shadow-2xl ${isDarkMode ? 'bg-[#0F0F0F] border-white/10' : 'bg-white border-black/10'}`}
      >
        <div
          className={`sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-5 py-5 sm:px-8 sm:py-7 ${isDarkMode ? 'border-white/5 bg-[#0F0F0F]/95' : 'border-black/5 bg-white/95'}`}
        >
          <div className="flex items-start gap-4">
            <div className={`mt-1 flex h-12 w-12 items-center justify-center rounded-2xl ${isDarkMode ? 'bg-[#E53935]/15 text-[#E53935]' : 'bg-red-50 text-[#E53935]'}`}>
              <FileSpreadsheet size={22} />
            </div>
            <div className="text-right">
              <h2 className={`text-lg font-bold sm:text-xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Export Clients</h2>
              <p className={`mt-1 text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {matchingCount.toLocaleString('en-US')} matching clients
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className={`rounded-full p-3 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${isDarkMode ? 'text-gray-500 hover:bg-white/5' : 'text-gray-400 hover:bg-black/5'}`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="admin-overlay-body">
          <div className="space-y-5 px-5 py-5 sm:space-y-6 sm:px-8 sm:py-7">
            <div className={`rounded-[1.5rem] border px-4 py-4 sm:px-5 ${isDarkMode ? 'border-white/6 bg-white/[0.02]' : 'border-black/5 bg-gray-50/70'}`}>
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-500">Format</span>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-[#E53935] shadow-[0_0_0_4px_rgba(229,57,53,0.12)]" />
                  <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Excel (.xlsx)</span>
                </div>
                <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] ${isDarkMode ? 'bg-white/5 text-gray-400' : 'bg-white text-gray-500'}`}>
                  Ready
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-500">Columns</span>
                <span className={`text-[11px] font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {selectedColumnIds.length}/{columns.length}
                </span>
              </div>

              <div className="grid gap-3">
                {columns.map((column) => {
                  const isChecked = selectedColumnIds.includes(column.id);

                  return (
                    <button
                      key={column.id}
                      type="button"
                      onClick={() => toggleColumn(column.id)}
                      aria-pressed={isChecked}
                      className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-right transition-all ${isChecked
                        ? isDarkMode
                          ? 'border-[#E53935]/35 bg-[#E53935]/10'
                          : 'border-[#E53935]/20 bg-red-50'
                        : isDarkMode
                          ? 'border-white/6 bg-white/[0.02]'
                          : 'border-black/5 bg-gray-50/70'
                        }`}
                    >
                      <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{column.label}</span>
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-black transition-all ${isChecked
                          ? 'border-[#E53935] bg-[#E53935] text-white'
                          : isDarkMode
                            ? 'border-white/12 text-transparent'
                            : 'border-black/10 text-transparent'
                          }`}
                      >
                        ✓
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className={`sticky bottom-0 z-10 flex flex-col-reverse gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-8 sm:py-6 ${isDarkMode ? 'border-white/5 bg-[#0F0F0F]/95' : 'border-black/5 bg-white/95'}`}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className={`w-full rounded-2xl border px-6 py-3 text-[10px] font-bold uppercase tracking-[0.25em] transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-gray-900 hover:bg-black/5'}`}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => onConfirm(selectedColumnIds)}
            disabled={isSubmitting || matchingCount === 0 || selectedColumnIds.length === 0}
            className="w-full rounded-2xl bg-[#E53935] px-7 py-3 text-[10px] font-bold uppercase tracking-[0.3em] text-white shadow-2xl shadow-red-900/20 transition-all hover:bg-[#FF3B30] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw size={14} className="animate-spin" />
                Preparing
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Download size={14} />
                Export
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClientsExportModal;
