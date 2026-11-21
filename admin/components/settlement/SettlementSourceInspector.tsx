import React, { useState } from 'react';
import {
  X,
  Receipt,
  Scissors,
  ShoppingBag,
  Wallet,
  TrendingDown,
  Clock,
  ExternalLink,
  ShieldCheck,
  Building,
  Calendar,
  DollarSign,
  User,
} from 'lucide-react';
import { PayrollPreviewLineItems } from './settlementTypes';

interface SettlementSourceInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  lineItems: PayrollPreviewLineItems | null;
  employeeName: string;
  isDarkMode: boolean;
  excludedCount?: number;
  dateFrom?: string;
  dateTo?: string;
}

export const SettlementSourceInspector: React.FC<SettlementSourceInspectorProps> = ({
  isOpen,
  onClose,
  lineItems,
  employeeName,
  isDarkMode,
  excludedCount = 0,
  dateFrom,
  dateTo,
}) => {
  const [activeTab, setActiveTab] = useState<
    'commissions' | 'advances' | 'withdrawals' | 'deductions' | 'overtimes' | 'carried'
  >('commissions');

  if (!isOpen) return null;

  const commissions = lineItems?.commissions || [];
  const advances = lineItems?.advances || [];
  const withdrawals = lineItems?.commission_withdrawals || [];
  const deductions = lineItems?.deductions || [];
  const overtimes = lineItems?.overtimes || [];
  const carried = lineItems?.carried_balances || [];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-end bg-black/70 backdrop-blur-sm animate-fade-in">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Slide-out Panel */}
      <div
        className={`relative z-10 w-full max-w-2xl h-full flex flex-col shadow-2xl border-r transition-all duration-300 ${isDarkMode
            ? 'bg-[#121418] border-white/10 text-white'
            : 'bg-white border-black/10 text-gray-900'
          }`}
        style={{
          fontFamily:
            "'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#8B0000]" />
              <span className="text-[10px] font-mono font-bold tracking-[0.15em] text-[#C5A880]">
                سجل التدقيق والمطابقة
              </span>
            </div>
            <h2 className="text-lg font-bold">
              فاحص المصادر والعمليات المالية — {employeeName}
            </h2>
            <p className="text-xs text-gray-400">
              مطابقة تفصيلية لكافة الفواتير والعمليات النقدية المعتمدة للمعاينة الحالية
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Exclusion / Integrity Notification Banner */}
        {excludedCount > 0 && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 flex items-start gap-2.5">
            <ShieldCheck size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <strong className="text-amber-300 block font-semibold">
                استبعاد {excludedCount} عملية مسواة مسبقاً لمنع الازدواج المالي:
              </strong>
              <p className="leading-relaxed opacity-90 text-[11px]">
                تم فحص كافة عمليات الموظف ضمن النطاق الزمني واستبعاد العمليات التي سُوّيت وأُقفلت بالفعل ضمن تسويات سابقة معتمدة، لضمان دقة الاستحقاقات وعدم تكرار الصرف أو الخصم.
              </p>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 p-2 border-b border-white/5 overflow-x-auto custom-scrollbar bg-black/20">
          {[
            {
              id: 'commissions',
              label: 'عمولات الفواتير',
              count: commissions.length,
              icon: <Scissors size={13} />,
            },
            {
              id: 'advances',
              label: 'السلفيات النقدية',
              count: advances.length,
              icon: <Wallet size={13} />,
            },
            {
              id: 'withdrawals',
              label: 'سحوبات النِسَب',
              count: withdrawals.length,
              icon: <TrendingDown size={13} />,
            },
            {
              id: 'deductions',
              label: 'الخصومات الإدارية',
              count: deductions.length,
              icon: <Receipt size={13} />,
            },
            {
              id: 'overtimes',
              label: 'الأوفر تايم',
              count: overtimes.length,
              icon: <Clock size={13} />,
            },
            {
              id: 'carried',
              label: 'أرصدة سابقة',
              count: carried.length,
              icon: <ShieldCheck size={13} />,
            },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${isActive
                    ? 'bg-[#8B0000]/20 text-[#E53935] border border-[#8B0000]/40 shadow-sm'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${isActive ? 'bg-[#8B0000]/40 text-white' : 'bg-white/5 text-gray-500'
                    }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar space-y-3">
          {/* 1. COMMISSIONS TAB */}
          {activeTab === 'commissions' && (
            <div className="space-y-2">
              {commissions.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-xs">
                  لا توجد فواتير أو عمليات عمولة مسجلة للموظف في هذه الفترة
                </div>
              ) : (
                commissions.map((c) => (
                  <div
                    key={c.source_id}
                    className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-white">
                          {c.title}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-gray-300">
                          فاتورة #{c.invoice_number}
                        </span>
                        <span className="text-[9px] font-mono text-gray-500">
                          {c.source_id}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-[#8B0000]/15 text-[#E53935]">
                          {c.earning_role === 'BARBER'
                            ? 'مصفف أساسي'
                            : c.earning_role === 'ASSISTANT'
                              ? 'مساعد'
                              : 'مبيعات منتجات'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-400">
                        <span>سعر الخدمة: {c.gross_price} ج.م</span>
                        <span>•</span>
                        <span>النسبة: {c.commission_percent}%</span>
                        <span>•</span>
                        <span className="flex items-center gap-1 font-mono">
                          <Building size={11} /> {c.branch_name}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-gray-500">
                          {c.date ? new Date(c.date).toLocaleDateString('ar-EG') : ''}
                        </span>
                      </div>
                    </div>

                    <div className="text-left font-mono">
                      <span className="text-sm font-bold text-emerald-400">
                        +{Number(c.commission_amount).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-500 block">ج.م</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 2. ADVANCES TAB */}
          {activeTab === 'advances' && (
            <div className="space-y-2">
              {advances.length === 0 ? (
                <div className="text-center py-12 px-4 text-gray-400 text-xs space-y-2">
                  <Wallet size={28} className="mx-auto text-gray-600 opacity-60" />
                  <p className="font-semibold text-gray-300">
                    لا توجد سلفيات نقدية غير مسواة لهذه الفترة
                  </p>
                  <p className="text-[11px] text-gray-500 max-w-md mx-auto leading-relaxed">
                    ملاحظة تدقيق: السلفيات النقدية السابقة المسجلة في ملف الموظف والتي تم تسويتها وإقفالها في تسويات سابقة معتمدة لا تظهر هنا منعاً لتكرار الخصم.
                  </p>
                </div>
              ) : (
                advances.map((a) => (
                  <div
                    key={a.source_id}
                    className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Wallet size={14} className="text-[#8B0000]" />
                        <span className="text-xs font-bold text-white">
                          سلفة نقدية من الخزينة
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">
                          #{a.action_id}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-400">
                        تاريخ الاستلام:{' '}
                        <span className="font-mono text-gray-300">
                          {new Date(a.created_at).toLocaleString('ar-EG')}
                        </span>
                      </div>
                    </div>

                    <div className="text-left font-mono">
                      <span className="text-sm font-bold text-rose-400">
                        -{Number(a.amount).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-500 block">ج.م</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 3. WITHDRAWALS TAB */}
          {activeTab === 'withdrawals' && (
            <div className="space-y-2">
              {withdrawals.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-xs">
                  لا توجد سحوبات نِسَب يومية مسبقة مسجلة في هذه الفترة
                </div>
              ) : (
                withdrawals.map((w) => (
                  <div
                    key={w.source_id}
                    className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <TrendingDown size={14} className="text-[#8B0000]" />
                        <span className="text-xs font-bold text-white">
                          سحب نسبة يومية مسبقة
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">
                          #{w.action_id}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400">
                        أموال عمولات مستلمة مسبقاً خلال الوردية
                      </p>
                    </div>

                    <div className="text-left font-mono">
                      <span className="text-sm font-bold text-rose-400">
                        -{Number(w.amount).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-500 block">ج.م</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 4. DEDUCTIONS TAB */}
          {activeTab === 'deductions' && (
            <div className="space-y-2">
              {deductions.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-xs">
                  لا توجد خصومات إدارية مسجلة
                </div>
              ) : (
                deductions.map((d) => (
                  <div
                    key={d.source_id}
                    className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-white block">
                        خصم إداري معتمد
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {d.notes || 'بدون تفاصيل إضافية'}
                      </span>
                    </div>
                    <div className="text-left font-mono">
                      <span className="text-sm font-bold text-rose-400">
                        -{Number(d.amount).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-500 block">ج.م</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 5. OVERTIMES TAB */}
          {activeTab === 'overtimes' && (
            <div className="space-y-2">
              {overtimes.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-xs">
                  لا توجد ساعات أوفر تايم معتمدة في هذه الفترة
                </div>
              ) : (
                overtimes.map((o) => (
                  <div
                    key={o.source_id}
                    className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-white block">
                        أوفر تايم وساعات إضافية
                      </span>
                      <span className="text-[11px] text-gray-400 font-mono">
                        {o.date}
                      </span>
                    </div>
                    <div className="text-left font-mono">
                      <span className="text-sm font-bold text-emerald-400">
                        +{Number(o.amount).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-500 block">ج.م</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 6. CARRIED BALANCES TAB */}
          {activeTab === 'carried' && (
            <div className="space-y-2">
              {carried.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-xs">
                  لا توجد تسويات سابقة غير مصفاة مرحلة إلى هذه الفترة
                </div>
              ) : (
                carried.map((cb) => (
                  <div
                    key={cb.source_id}
                    className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-white block">
                        ترحيل رصيد من تسوية سابقة #{cb.settlement_number}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        رصيد معتمد غير منصرف أو مديونية مرحلة
                      </span>
                    </div>
                    <div className="text-left font-mono">
                      <span
                        className={`text-sm font-bold ${cb.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                      >
                        {cb.amount >= 0 ? '+' : ''}
                        {Number(cb.amount).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-500 block">ج.م</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default SettlementSourceInspector;
