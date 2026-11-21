import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, X, CheckCircle2, Lock } from 'lucide-react';

interface SettlementOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  conflictDetails: string;
  isSubmitting: boolean;
  isDarkMode: boolean;
}

export const SettlementOverrideModal: React.FC<SettlementOverrideModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  conflictDetails,
  isSubmitting,
  isDarkMode,
}) => {
  const [authorizedChecked, setAuthorizedChecked] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorizedChecked) {
      setErrorMsg('يجب تفعيل خيار الإقرار الإداري الصريح للمتابعة');
      return;
    }
    const cleanReason = overrideReason.trim();
    if (!cleanReason) {
      setErrorMsg('يجب كتابة سبب توثيقي واضح للاعتماد الاستثنائي للراتب الأساسي');
      return;
    }
    setErrorMsg('');
    onConfirm(cleanReason);
  };

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className={`w-full max-w-lg p-6 sm:p-7 rounded-3xl border shadow-2xl space-y-6 ${
          isDarkMode
            ? 'bg-[#14161B] border-white/10 text-white'
            : 'bg-white border-black/10 text-gray-900'
        }`}
        style={{
          fontFamily:
            "'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">
                تفويض استثنائي: اعتماد راتب أساسي متداخل
              </h3>
              <p className="text-xs text-gray-400">
                صلاحية الإدارة العليا (Super Admin / Exec Admin)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Warning / Conflict details */}
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 leading-relaxed space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-amber-300">
            <AlertTriangle size={14} />
            <span>تنبيه تكرار الراتب الأساسي:</span>
          </div>
          <p>{conflictDetails}</p>
          <p className="text-[11px] text-amber-300/80 pt-1">
            لا يمكن اعتماد تسوية تحتوي على راتب أساسي متداخل مع تسوية أخرى معتمدة دون تفويض صريح وسبب مسجل في سجل الرقابة المالي.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Reason Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-300 flex items-center justify-between">
              <span>سبب الاعتماد الاستثنائي (إلزامي للتوثيق):</span>
              <span className="text-[10px] text-rose-400 font-mono">* إلزامي</span>
            </label>
            <textarea
              value={overrideReason}
              onChange={(e) => {
                setOverrideReason(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              rows={3}
              placeholder="مثال: موافقة الإدارة العامة على صرف مكافأة راتب استثنائي للفترة بموجب قرار إداري..."
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-white/5 border border-white/10 text-white placeholder-gray-500 outline-none focus:border-[#8B0000] transition-colors resize-none"
            />
          </div>

          {/* Authorization Checkbox */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={authorizedChecked}
              onChange={(e) => {
                setAuthorizedChecked(e.target.checked);
                if (errorMsg) setErrorMsg('');
              }}
              className="mt-0.5 rounded border-white/20 text-[#8B0000] focus:ring-[#8B0000] cursor-pointer"
            />
            <span className="text-xs text-gray-300 leading-relaxed">
              أقر بصفتي مسؤول الإدارة العليا بصحة صرف الراتب الأساسي المتداخل لهذه الفترة وأتحمل المسؤولية الإدارية والمالية عن هذا الاعتماد.
            </span>
          </label>

          {errorMsg && (
            <p className="text-xs text-rose-400 font-bold bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/20">
              {errorMsg}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-[#8B0000] hover:bg-[#A00000] text-white py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#8B0000]/25 active:scale-95 disabled:opacity-50"
            >
              <Lock size={13} />
              <span>{isSubmitting ? 'جاري الاعتماد والتوثيق...' : 'تأكيد التفويض واعتماد التسوية'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-white/10 text-xs font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
export default SettlementOverrideModal;
