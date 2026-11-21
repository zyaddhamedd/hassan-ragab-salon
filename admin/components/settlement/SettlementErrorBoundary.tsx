import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface SettlementErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface SettlementErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class SettlementErrorBoundary extends Component<
  SettlementErrorBoundaryProps,
  SettlementErrorBoundaryState
> {
  public state: SettlementErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): SettlementErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Settlement Studio] Caught render error:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="w-full h-full min-h-[400px] flex items-center justify-center p-6"
          style={{ direction: 'rtl' }}
        >
          <div className="w-full max-w-lg p-6 sm:p-8 rounded-2xl bg-[#141518] border border-rose-500/30 text-rose-200 text-center shadow-2xl space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto shadow-sm">
              <AlertCircle size={28} />
            </div>
            <h3 className="font-serif font-black text-lg text-white">
              {this.props.fallbackTitle || 'تعذر عرض مستند التسوية المالية'}
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed max-w-md mx-auto">
              {this.state.error?.message ||
                'حدث استثناء غير متوقع أثناء معالجة بيانات التسوية. تم حماية الواجهة من الإغلاق.'}
            </p>
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#8B0000] to-[#550000] hover:from-[#A00000] hover:to-[#650000] text-white font-bold text-xs shadow-lg transition-all cursor-pointer"
              >
                <RefreshCw size={13} />
                <span>إعادة تحميل لوحة الاستوديو</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
