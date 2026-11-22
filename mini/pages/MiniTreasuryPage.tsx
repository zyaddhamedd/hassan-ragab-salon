import React, { useState, useEffect } from 'react';
import { apiClient } from '../src/api/client';
import { RefreshCw, LayoutDashboard, Wallet, ArrowDownRight, ArrowUpRight, Scale, CreditCard, Smartphone, TrendingUp } from 'lucide-react';

interface MiniTreasuryPageProps {
    onBusinessDayClosed?: () => Promise<void>;
}

interface SummaryData {
    exists: boolean;
    business_day_id?: number;
    status?: 'OPEN' | 'CLOSED';
    opened_at?: string;
    cash_in?: number;
    visa_in?: number;
    visa_1_in?: number;
    visa_2_in?: number;
    visa_unassigned_in?: number;
    instapay_in?: number;
    visa_collected?: number;
    visa_1_collected?: number;
    visa_2_collected?: number;
    visa_unassigned_collected?: number;
    instapay_collected?: number;
    invoice_cash_in?: number;
    invoice_visa_in?: number;
    invoice_instapay_in?: number;
    invoice_visa_collected?: number;
    invoice_instapay_collected?: number;
    appointment_deposit_cash_in?: number;
    appointment_deposit_visa_in?: number;
    appointment_deposit_instapay_in?: number;
    appointment_deposit_visa_collected?: number;
    appointment_deposit_instapay_collected?: number;
    cash_out?: number;
    theoretical_balance?: number;
    total_sales?: number;
    appointment_deposit_total?: number;
    total_collected?: number;
}

interface Expense {
    id: string;
    type?: string;
    categoryId?: number;
    category_name?: string;
    category?: {
        id: number;
        name: string;
    };
    amount: number;
    notes?: string;
    description?: string;
    date?: string;
    time?: string;
    expense_date?: string;
    created_at?: string;
    cashierName?: string;
}

// ── Reconciliation components (module-level to prevent remounting) ──

/** Renders a coloured diff badge */
const DiffBadge = ({ diff }: { diff: number }) => {
    if (Math.abs(diff) < 0.005) {
        return <span className="text-xs font-bold text-white/40">±0</span>;
    }
    const positive = diff > 0;
    return (
        <span className={`text-xs font-bold ${positive ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
            {positive ? '+' : ''}{diff.toFixed(2)}
        </span>
    );
};

/** One row in the close modal */
const ReconcileRow = ({
    label, color, expected, actualStr, onActualChange,
}: {
    label: string;
    color: string;
    expected: number;
    actualStr: string;
    onActualChange: (v: string) => void;
}) => {
    const actual = Number(actualStr || '0');
    const diff = isNaN(actual) ? 0 : actual - expected;

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
            {/* Expected */}
            <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">متوقع</p>
                <p className={`font-bold text-sm ${color}`} dir="ltr">{(expected ?? 0).toFixed(2)} EGP</p>
            </div>
            {/* Actual input */}
            <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">فعلي — {label}</p>
                <input
                    type="number"
                    value={actualStr}
                    onChange={e => onActualChange(e.target.value)}
                    placeholder="0.00"
                    dir="ltr"
                    className="w-full bg-[#121212] border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-bold focus:outline-none focus:border-[#E6D690] transition-colors"
                />
            </div>
            {/* Live diff */}
            <div className="text-left min-w-[48px]">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">فرق</p>
                {actualStr ? <DiffBadge diff={diff} /> : <span className="text-xs text-white/20">—</span>}
            </div>
        </div>
    );
};

// Helper function to detect expense label from API category field
function getExpenseLabel(exp: any): string {
    // API returns 'category' field with the correct category name
    // Examples: 'سلفة', 'نسبة يومية', 'أوفر تايم', etc.
    return exp.category || 'مصروف';
}

const MiniTreasuryPage: React.FC<MiniTreasuryPageProps> = ({ onBusinessDayClosed }) => {
    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState<SummaryData | null>(null);

    // Modal state
    const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
    const [actualCashStr, setActualCashStr] = useState('');
    const [actualVisa1Str, setActualVisa1Str] = useState('');
    const [actualVisa2Str, setActualVisa2Str] = useState('');
    const [actualInstapayStr, setActualInstapayStr] = useState('');
    const [isClosing, setIsClosing] = useState(false);
    const [closeReport, setCloseReport] = useState<any>(null);
    const [closeSuccessMessage, setCloseSuccessMessage] = useState('');
    const [refreshWarningMessage, setRefreshWarningMessage] = useState<string | null>(null);

    // Expenses Modal state
    const [showExpensesModal, setShowExpensesModal] = useState(false);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [expensesLoading, setExpensesLoading] = useState(false);

    const fetchSummary = async () => {
        setLoading(true);
        try {
            const data = await apiClient.get('/business-day/summary');
            setSummary(data);
        } catch (error) {
            console.error('Failed to fetch business day summary:', error);
            alert('فشل في جلب بيانات اليومية.');
        } finally {
            setLoading(false);
        }
    };

    const fetchExpenses = async () => {
        setExpensesLoading(true);
        try {
            const data = await apiClient.get('/expenses/today');
            setExpenses(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to fetch expenses:', error);
            setExpenses([]);
        } finally {
            setExpensesLoading(false);
        }
    };

    useEffect(() => {
        fetchSummary();
    }, []);

    // Fetch expenses when modal opens
    useEffect(() => {
        if (showExpensesModal) {
            fetchExpenses();
        }

        // Handle ESC key to close modal
        const handleEscKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowExpensesModal(false);
            }
        };

        if (showExpensesModal) {
            window.addEventListener('keydown', handleEscKey);
            return () => window.removeEventListener('keydown', handleEscKey);
        }
    }, [showExpensesModal]);

    const handleOpenDay = async () => {
        try {
            setLoading(true);
            await apiClient.post('/business-day/open', {});
            await fetchSummary();
        } catch (error: any) {
            console.error('Failed to open business day:', error);
            alert(error.message || 'فشل فتح اليومية.');
            setLoading(false);
            // Refetch summary even on error to show actual backend state
            await fetchSummary();
        }
    };

    const submitCloseDay = async () => {
        const cash = Number(actualCashStr);
        const visa1 = Number(actualVisa1Str || '0');
        const visa2 = Number(actualVisa2Str || '0');
        const visa = visa1 + visa2;
        const instapay = Number(actualInstapayStr || '0');

        if (!actualCashStr || isNaN(cash)) {
            alert('الرجاء إدخال الرصيد الفعلي للكاش');
            return;
        }

        try {
            setIsClosing(true);
            setRefreshWarningMessage(null);
            const res = await apiClient.post('/business-day/close', {
                actual_balance: cash,       // canonical close field (unchanged)
                actual_cash: cash,
                actual_visa: visa,
                actual_visa_1: visa1,
                actual_visa_2: visa2,
                actual_instapay: instapay,
            });
            const autoCheckedOutCount = Number(res.auto_checked_out_count ?? 0);
            const cashierData = JSON.parse(localStorage.getItem('mini_cashier') || '{}');
            const reportData = {
                ...res,
                opened_at: summary?.opened_at,
                branch_name: cashierData.branch_name || '',
                cashier_name: cashierData.name || '',
            };
            setCloseSuccessMessage(
                autoCheckedOutCount > 0
                    ? `تم إقفال الخزنة وتسجيل انصراف ${autoCheckedOutCount} موظفين`
                    : 'تم إقفال الخزنة بنجاح'
            );
            setCloseReport(reportData);
            setIsCloseModalOpen(false);
            setSummary(prev => prev ? { ...prev, exists: false } : null);

            try {
                await onBusinessDayClosed?.();
            } catch (refreshError) {
                console.error('Staff refresh after close failed:', refreshError);
                setRefreshWarningMessage('تم إقفال الخزنة بنجاح لكن تعذر تحديث بيانات الحضور. يرجى تحديث الشاشة يدويًا.');
            }
            
            // Auto-print thermal receipt after a short delay
            setTimeout(() => {
                handlePrintReceiptReport(reportData);
            }, 500);
        } catch (error: any) {
            console.error('Failed to close day:', error);
            alert(error.message || 'فشل إقفال اليومية.');
            // Refetch summary on close error to ensure UI stays in sync
            await fetchSummary();
        } finally {
            setIsClosing(false);
        }
    };

    /** 80mm thermal receipt print — close report */
    const handlePrintReceiptReport = (reportData?: any) => {
        const data = reportData || closeReport;
        if (!data) return;

        const f = (n: number | null | undefined) => (n ?? 0).toFixed(2);
        const fd = (n: number | null | undefined) => { const v = n ?? 0; return (v > 0 ? '+' : '') + v.toFixed(2); };

        const formatDateTime = (iso: string | undefined) => {
            if (!iso) return '---';
            return new Date(iso).toLocaleString('ar-EG', {
                timeZone: 'Africa/Cairo',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
            });
        };

        const businessDate = data.closed_at
            ? new Date(data.closed_at).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
            : '---';

        const row = (label: string, val: string, color = '#000') =>
            `<tr><td class="r">${label}</td><td class="l" style="color:${color}">${val}</td></tr>`;

        // Income totals
        const daily_income = data.daily_income ?? ((data.cash_in ?? 0) + (data.visa_in ?? 0) + (data.instapay_in ?? 0));
        const net_daily = data.net_daily ?? ((data.actual_cash ?? 0) + (data.actual_visa ?? 0) + (data.actual_instapay ?? 0));
        const total_expenses = data.total_expenses ?? data.cash_out ?? 0;
        const advance_total = data.advance_total ?? 0;
        const overtime_total = data.overtime_total ?? 0;
        const commission_total = data.commission_total ?? 0;
        const manual_expenses_total = data.manual_expenses_total ?? 0;

        const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير إقفال - كاشير</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      direction: rtl;
      width: 100%;
    }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .receipt-container {
      width: 100%;
      max-width: 260px;
      margin: 0 auto;
      padding: 3mm;
      text-align: center;
    }
    .header {
      font-size: 12px;
      font-weight: bold;
      margin-bottom: 2px;
      text-align: center;
    }
    .subtitle {
      font-size: 9px;
      color: #555;
      margin-bottom: 3px;
      text-align: center;
    }
    .section-title {
      font-size: 10px;
      font-weight: bold;
      background: #000;
      color: #fff;
      padding: 2px 0;
      margin: 4px 0 2px 0;
      text-align: center;
    }
    .section {
      margin-bottom: 3px;
    }
    .divider-thin {
      border-top: 1px dashed #000;
      margin: 2px 0;
    }
    .divider-thick {
      border-top: 2px solid #000;
      margin: 3px 0;
    }
    table {
      width: auto;
      margin: 0 auto;
      border-collapse: collapse;
      font-size: 11px;
    }
    td {
      padding: 1px 3px;
      vertical-align: top;
    }
    td.label {
      text-align: right;
      padding-right: 0;
    }
    td.value {
      text-align: left;
      padding-left: 0;
      font-weight: normal;
    }
    .total-row td {
      font-weight: bold;
      font-size: 11px;
      padding-top: 2px;
      border-top: 1px dashed #000;
    }
    .footer {
      text-align: center;
      font-size: 10px;
      margin-top: 6px;
    }
    .success {
      font-weight: bold;
      margin-bottom: 3px;
    }
    .signature-line {
      font-size: 9px;
      margin-top: 3px;
    }

    @media print {
      @page {
        size: 80mm auto;
        margin: 0;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        height: auto !important;
      }
      .receipt-container {
        width: 100%;
        max-width: 260px;
        margin: 0 auto !important;
        padding: 3mm !important;
      }
      .receipt-container * {
        color: #000 !important;
        opacity: 1 !important;
      }
      .subtitle {
        font-size: 10px;
        font-weight: 600;
      }
      .shift-number {
        font-size: 11px;
        font-weight: 800;
      }
      .section-title {
        background: #fff !important;
        font-size: 11px;
        font-weight: 800;
        outline: 1px solid #000;
      }
      td.label, td.value {
        font-weight: 600;
      }
      .total-row td {
        font-weight: 700;
        border-top: 2px dashed #000;
      }
      .divider-thin {
        border-top: 2px dashed #000;
      }
      .signature-line {
        font-size: 10px;
        font-weight: 600;
      }
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <!-- HEADER -->
    <div class="header">${data.branch_name || 'صالون'}</div>
    <div class="subtitle">تقفيل الخزنة</div>
    <div class="subtitle shift-number">رقم اليومية: ${data.business_day_id}</div>
    <div class="divider-thin"></div>

    <!-- INCOME SECTION -->
    <div class="section">
      <div class="section-title">📥 دخل اليوم</div>
      <table>
        <tr>
          <td class="label">كاش</td>
          <td class="value">${f(data.cash_in)} ج.م</td>
        </tr>
        <tr>
          <td class="label">فيزا 1 (محصل)</td>
          <td class="value">${f(data.visa_1_collected ?? data.visa_1_in)} ج.م</td>
        </tr>
        <tr>
          <td class="label">فيزا 2 (محصل)</td>
          <td class="value">${f(data.visa_2_collected ?? data.visa_2_in)} ج.م</td>
        </tr>
        <tr>
          <td class="label">إجمالي فيزا (محصل)</td>
          <td class="value">${f(data.visa_collected ?? data.visa_in)} ج.م</td>
        </tr>
        <tr>
          <td class="label">انستا (محصل)</td>
          <td class="value">${f(data.instapay_collected ?? data.instapay_in)} ج.م</td>
        </tr>
        <tr class="total-row">
          <td class="label">اجمالي</td>
          <td class="value">${f(daily_income)} ج.م</td>
        </tr>
      </table>
      <div class="divider-thick"></div>
    </div>

    <!-- EXPENSES SECTION -->
    <div class="section">
      <div class="section-title">📤 المصروفات</div>
      <table>
        <tr>
          <td class="label">مصروفات</td>
          <td class="value">${f(manual_expenses_total)} ج.م</td>
        </tr>
        <tr>
          <td class="label">سلف</td>
          <td class="value">${f(advance_total)} ج.م</td>
        </tr>
        <tr>
          <td class="label">أوفر تايم</td>
          <td class="value">${f(overtime_total)} ج.م</td>
        </tr>
        <tr>
          <td class="label">نسب</td>
          <td class="value">${f(commission_total)} ج.م</td>
        </tr>
        <tr class="total-row">
          <td class="label">اجمالي</td>
          <td class="value">${f(total_expenses)} ج.م</td>
        </tr>
      </table>
      <div class="divider-thick"></div>
    </div>

    <!-- NET SECTION -->
    <div class="section">
      <div class="section-title">💰 صافي دخل اليوم</div>
      <table>
        <tr>
          <td class="label">كاش</td>
          <td class="value">${f(data.actual_cash)} ج.م</td>
        </tr>
        <tr>
          <td class="label">فيزا 1</td>
          <td class="value">${f(data.actual_visa_1)} ج.م</td>
        </tr>
        <tr>
          <td class="label">فيزا 2</td>
          <td class="value">${f(data.actual_visa_2)} ج.م</td>
        </tr>
        <tr>
          <td class="label">إجمالي فيزا</td>
          <td class="value">${f(data.actual_visa)} ج.م</td>
        </tr>
        <tr>
          <td class="label">انستا</td>
          <td class="value">${f(data.actual_instapay)} ج.م</td>
        </tr>
        <tr class="total-row">
          <td class="label">اجمالي</td>
          <td class="value">${f(net_daily)} ج.م</td>
        </tr>
      </table>
      <div class="divider-thick"></div>
    </div>

    <!-- META INFORMATION -->
    <div class="section">
      <table>
        <tr>
          <td class="label">الكاشير</td>
          <td class="value">${data.cashier_name || '---'}</td>
        </tr>
        <tr>
          <td class="label">التاريخ</td>
          <td class="value">${businessDate}</td>
        </tr>
      </table>
      <div class="divider-thin"></div>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      <div class="success">✓ تم الإقفال بنجاح</div>
      <div class="signature-line">أمين الصندوق: __________</div>
      <div class="signature-line">المدير: __________</div>
    </div>
  </div>
</body>
</html>`;

        const win = window.open('', '_blank');
        if (win) { 
            win.document.write(html); 
            win.document.close(); 
            win.onload = () => {
                win.focus();
                win.print(); 
            };
        }
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    const fmt2 = (n?: number) => (n ?? 0).toFixed(2);

    // --- Renderers ---

    if (loading && !summary) {
        return (
            <div className="mini-screen flex items-center justify-center bg-[#121212]">
                <div className="w-8 h-8 border-4 border-[#E6D690]/20 border-t-[#E6D690] rounded-full animate-spin" />
            </div>
        );
    }

    // 1. Success Report (just closed)
    if (closeReport) {
        const diffCash = closeReport.diff_cash ?? 0;
        const diffVisa = (closeReport.actual_visa ?? 0) - (closeReport.visa_collected ?? closeReport.visa_in ?? 0);
        const diffInstapay = (closeReport.actual_instapay ?? 0) - (closeReport.instapay_collected ?? closeReport.instapay_in ?? 0);

        const MethodRow = ({ label, color, expected, actual, diff }: {
            label: string; color: string;
            expected: number; actual: number; diff: number;
        }) => (
            <div className="flex items-center justify-between py-3 border-b border-white/5">
                <div>
                    <span className="text-[#BDBDBD] block">{label}</span>
                    <div className="flex gap-3 mt-0.5">
                        <span className="text-[10px] text-gray-500">متوقع: <span className={`font-bold ${color}`}>{fmt2(expected)}</span></span>
                        <span className="text-[10px] text-gray-500">فعلي: <span className="font-bold text-white">{fmt2(actual)}</span></span>
                    </div>
                </div>
                <DiffBadge diff={diff} />
            </div>
        );

        return (
            <div className="mini-screen bg-[#121212]" dir="rtl">
                <div className="mini-scroll-y mini-page-body custom-scrollbar">
                <div className="mx-auto max-w-xl space-y-8">
                    <div className="text-center space-y-4">
                        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h1 className="text-3xl font-bold text-white">تم إقفال اليوم بنجاح</h1>
                        <p className="text-[#E6D690] text-sm font-bold">{closeSuccessMessage}</p>
                        <p className="text-[#BDBDBD]">رقم اليومية: {closeReport.business_day_id}</p>
                        {refreshWarningMessage && (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                                {refreshWarningMessage}
                            </div>
                        )}
                    </div>

                    {/* Per-method reconciliation */}
                    <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-6">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">مطابقة وسائل الدفع</p>
                        <MethodRow label="كاش" color="text-emerald-400" expected={closeReport.cash_in ?? 0} actual={closeReport.actual_cash ?? 0} diff={diffCash} />
                        <MethodRow label="فيزا 1" color="text-blue-400" expected={closeReport.visa_1_collected ?? closeReport.visa_1_in ?? 0} actual={closeReport.actual_visa_1 ?? 0} diff={closeReport.diff_visa_1 ?? 0} />
                        <MethodRow label="فيزا 2" color="text-cyan-400" expected={closeReport.visa_2_collected ?? closeReport.visa_2_in ?? 0} actual={closeReport.actual_visa_2 ?? 0} diff={closeReport.diff_visa_2 ?? 0} />
                        <MethodRow label="إجمالي فيزا" color="text-indigo-400" expected={closeReport.visa_collected ?? closeReport.visa_in ?? 0} actual={closeReport.actual_visa ?? 0} diff={diffVisa} />
                        <MethodRow label="إنستاباي" color="text-violet-400" expected={closeReport.instapay_collected ?? closeReport.instapay_in ?? 0} actual={closeReport.actual_instapay ?? 0} diff={diffInstapay} />
                    </div>

                    {/* Treasury Summary */}
                    <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-6 space-y-4">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">ملخص الخزينة</p>
                        <div className="flex justify-between items-center py-3 border-b border-white/5">
                            <span className="text-[#BDBDBD]">الدخل اليومي</span>
                            <span className="font-bold text-emerald-400" dir="ltr">{(closeReport.daily_income ?? 0).toFixed(2)} ج.م</span>
                        </div>
                        <div className="flex justify-between items-center py-3">
                            <span className="text-[#BDBDBD]">الصافي اليومي</span>
                            <span className="font-bold text-[#E6D690]" dir="ltr">{(closeReport.net_daily ?? 0).toFixed(2)} ج.م</span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={() => {
                                setCloseReport(null);
                                fetchSummary();
                            }}
                            className="w-full bg-[#E6D690] hover:bg-[#D4C47D] text-[#121212] py-4 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            عودة للرئيسية
                        </button>
                        <button
                            onClick={() => handlePrintReceiptReport()}
                            className="w-full bg-[#2A2A2A] hover:bg-[#383838] border border-[#E6D690]/30 text-[#E6D690] py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z" />
                            </svg>
                            طباعة الكاشير
                        </button>
                    </div>
                </div>
                </div>
            </div>
        );
    }

    // 2. Day is Closed (Needs Opening)
    if (!summary?.exists) {
        return (
            <div className="mini-screen mini-page-body flex items-center justify-center bg-[#121212] pointer-events-auto" dir="rtl">
                <div className="bg-[#1E1E1E] border border-[#E6D690]/20 rounded-2xl p-10 max-w-md w-full text-center space-y-6 shadow-2xl">
                    <div className="w-24 h-24 bg-[#E6D690]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Wallet className="w-12 h-12 text-[#E6D690]" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">لا يوجد يوم مالي مفتوح</h1>
                    <p className="text-[#BDBDBD] text-sm leading-relaxed">
                        يجب فتح يومية جديدة قبل تسجيل أي فواتير كاش أو مصروفات على الخزينة.
                    </p>
                    <button
                        onClick={handleOpenDay}
                        disabled={loading}
                        className="w-full bg-[#E6D690] hover:bg-[#D4C47D] text-[#121212] font-bold py-4 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'فتح اليوم'}
                    </button>
                </div>
            </div>
        );
    }

    // 3. Day is Open (Dashboard)
    return (
        <div className="mini-screen bg-[#121212] pointer-events-auto" dir="rtl">
        <div className="mini-scroll-y mini-page-body custom-scrollbar">

            {/* Header */}
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
                        <LayoutDashboard className="w-8 h-8 text-[#E6D690]" />
                        الخزينة
                    </h1>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#BDBDBD]">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        يومية مفتوحة منذ {new Date(summary.opened_at!).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                </div>

                <button
                    onClick={() => fetchSummary()}
                    className="p-3 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#BDBDBD] hover:text-white rounded-xl transition-colors border border-white/5"
                    title="تحديث البيانات"
                >
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">

                {/* Cash IN */}
                <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-colors" />
                    <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                            <ArrowDownRight className="w-6 h-6 text-emerald-400" />
                        </div>
                    </div>
                    <p className="text-[#BDBDBD] text-sm mb-1 relative z-10">تحصيل الكاش</p>
                    <h2 className="text-3xl font-bold text-white relative z-10 tracking-tight" dir="ltr">
                        {summary.cash_in?.toFixed(2)} <span className="text-sm text-[#BDBDBD] font-normal">EGP</span>
                    </h2>
                </div>

                {/* Cash OUT */}
                <div
                    onClick={() => setShowExpensesModal(true)}
                    className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-6 relative overflow-hidden group cursor-pointer hover:scale-[1.02] transition-transform duration-200"
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-3xl group-hover:bg-rose-500/10 transition-colors" />
                    <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="w-12 h-12 bg-rose-500/10 rounded-xl flex items-center justify-center">
                            <ArrowUpRight className="w-6 h-6 text-rose-400" />
                        </div>
                    </div>
                    <p className="text-[#BDBDBD] text-sm mb-1 relative z-10">المصروفات النقدية</p>
                    <h2 className="text-3xl font-bold text-white relative z-10 tracking-tight" dir="ltr">
                        {summary.cash_out?.toFixed(2)} <span className="text-sm text-[#BDBDBD] font-normal">EGP</span>
                    </h2>
                </div>

                {/* Theoretical Balance */}
                <div className="bg-gradient-to-br from-[#E6D690]/20 to-[#1E1E1E] border border-[#E6D690]/30 rounded-2xl p-6 relative overflow-hidden shadow-lg shadow-[#E6D690]/5">
                    <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="w-12 h-12 bg-[#E6D690]/20 rounded-xl flex items-center justify-center">
                            <Scale className="w-6 h-6 text-[#E6D690]" />
                        </div>
                    </div>
                    <p className="text-[#E6D690]/80 text-sm mb-1 relative z-10 font-medium">الرصيد الدفتري الحالي</p>
                    <h2 className="text-4xl font-bold text-white relative z-10 tracking-tight" dir="ltr">
                        {summary.theoretical_balance?.toFixed(2)} <span className="text-sm text-[#E6D690]/50 font-normal">EGP</span>
                    </h2>
                </div>

                {/* Visa IN */}
                <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors" />
                    <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center">
                            <CreditCard className="w-6 h-6 text-blue-400" />
                        </div>
                    </div>
                    <p className="text-[#BDBDBD] text-sm mb-1 relative z-10">تحصيل الفيزا</p>
                    <h2 className="text-3xl font-bold text-white relative z-10 tracking-tight" dir="ltr">
                        {(summary.visa_collected ?? summary.visa_in ?? 0).toFixed(2)} <span className="text-sm text-[#BDBDBD] font-normal">EGP</span>
                    </h2>
                </div>

                {/* Instapay IN */}
                <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/5 rounded-full blur-3xl group-hover:bg-violet-500/10 transition-colors" />
                    <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="w-12 h-12 bg-violet-500/10 rounded-xl flex items-center justify-center">
                            <Smartphone className="w-6 h-6 text-violet-400" />
                        </div>
                    </div>
                    <p className="text-[#BDBDBD] text-sm mb-1 relative z-10">تحصيل إنستاباي</p>
                    <h2 className="text-3xl font-bold text-white relative z-10 tracking-tight" dir="ltr">
                        {(summary.instapay_collected ?? summary.instapay_in ?? 0).toFixed(2)} <span className="text-sm text-[#BDBDBD] font-normal">EGP</span>
                    </h2>
                </div>

                {/* Total Sales */}
                <div className="bg-[#1E1E1E] border border-white/5 rounded-2xl p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-teal-500/5 rounded-full blur-3xl group-hover:bg-teal-500/10 transition-colors" />
                    <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="w-12 h-12 bg-teal-500/10 rounded-xl flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-teal-400" />
                        </div>
                    </div>
                    <p className="text-[#BDBDBD] text-sm mb-1 relative z-10">إجمالي التحصيل</p>
                    <h2 className="text-3xl font-bold text-white relative z-10 tracking-tight" dir="ltr">
                        {(summary.total_collected ?? summary.total_sales ?? 0).toFixed(2)} <span className="text-sm text-[#BDBDBD] font-normal">EGP</span>
                    </h2>
                </div>

            </div>

            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/5 bg-[#1A1A1A] p-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#E6D690]">مبيعات الفواتير</p>
                    <h3 className="mt-2 text-2xl font-black text-white" dir="ltr">
                        {(summary.total_sales ?? 0).toFixed(2)} <span className="text-sm font-normal text-[#BDBDBD]">EGP</span>
                    </h3>
                    <p className="mt-2 text-xs text-white/45">
                        هذا الرقم يخص الفواتير المؤكدة فقط بدون عربون المواعيد.
                    </p>
                </div>

                <div className="rounded-2xl border border-[#E6D690]/15 bg-[#1A1A1A] p-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#E6D690]">عربون المواعيد</p>
                    <h3 className="mt-2 text-2xl font-black text-white" dir="ltr">
                        {(summary.appointment_deposit_total ?? 0).toFixed(2)} <span className="text-sm font-normal text-[#BDBDBD]">EGP</span>
                    </h3>
                    <p className="mt-2 text-xs text-white/45">
                        محصّل ماليًا داخل اليومية الحالية ويظهر في الرصيد الدفتري مباشرة.
                    </p>
                </div>
            </div>

            {/* Close Action */}
            <div className="bg-[#1E1E1E] border border-rose-500/20 rounded-2xl p-8 text-center mt-auto">
                <h3 className="text-xl font-bold text-white mb-2">إنهاء اليومية المفتوحة</h3>
                <p className="text-[#BDBDBD] mb-6 text-sm max-w-md mx-auto">
                    سيتم إقفال الخزينة بعد مطابقة كل وسيلة دفع مع الأرقام الفعلية.
                </p>
                <button
                    onClick={() => setIsCloseModalOpen(true)}
                    className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold py-3 px-12 rounded-xl transition-all active:scale-[0.98]"
                >
                    إقفال اليوم
                </button>
            </div>

            {/* ── Close Modal ── */}
            {isCloseModalOpen && (
                <div className="mini-modal-overlay">
                    <div className="mini-modal-panel-static bg-[#1E1E1E] border border-white/10 rounded-2xl p-6 lg:p-8 max-w-lg w-full shadow-2xl relative" onClick={e => e.stopPropagation()}>
                        <h2 className="text-2xl font-bold text-white mb-6 text-center">جرد الخزينة (إقفال اليوم)</h2>

                        <div className="mini-scroll-y custom-scrollbar space-y-5 pr-1">
                            {/* Section header */}
                            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">مطابقة كل وسيلة دفع</p>

                            {/* Cash row */}
                            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4">
                                <ReconcileRow
                                    label="كاش 💵"
                                    color="text-emerald-400"
                                    expected={(summary.cash_in ?? 0) - (summary.cash_out ?? 0)}  // Cash expected = net drawer balance (cash_in - cash_out)
                                    actualStr={actualCashStr}
                                    onActualChange={setActualCashStr}
                                />
                            </div>

                            {/* Visa 1 row */}
                            <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-4">
                                <ReconcileRow
                                    label="فيزا 1 💳"
                                    color="text-blue-400"
                                    expected={summary.visa_1_collected ?? summary.visa_1_in ?? 0}
                                    actualStr={actualVisa1Str}
                                    onActualChange={setActualVisa1Str}
                                />
                            </div>

                            {/* Visa 2 row */}
                            <div className="bg-cyan-500/5 border border-cyan-500/10 rounded-xl p-4">
                                <ReconcileRow
                                    label="فيزا 2 💳"
                                    color="text-cyan-400"
                                    expected={summary.visa_2_collected ?? summary.visa_2_in ?? 0}
                                    actualStr={actualVisa2Str}
                                    onActualChange={setActualVisa2Str}
                                />
                            </div>

                            {/* InstaPay row */}
                            <div className="bg-violet-500/5 border border-violet-500/10 rounded-xl p-4">
                                <ReconcileRow
                                    label="إنستاباي 📱"
                                    color="text-violet-400"
                                    expected={summary.instapay_collected ?? summary.instapay_in ?? 0}
                                    actualStr={actualInstapayStr}
                                    onActualChange={setActualInstapayStr}
                                />
                            </div>

                            {/* Totals summary row */}
                            {actualCashStr && (
                                <div className="pt-4 border-t border-white/10 space-y-2">
                                    {(() => {
                                        const cash = Number(actualCashStr || '0');
                                        const visa1 = Number(actualVisa1Str || '0');
                                        const visa2 = Number(actualVisa2Str || '0');
                                        const visa = visa1 + visa2;
                                        const instapay = Number(actualInstapayStr || '0');
                                        const totalActual = cash + visa + instapay;
                                        const totalExpected =
                                          ((summary.cash_in ?? 0) - (summary.cash_out ?? 0)) +
                                          (summary.visa_collected ?? summary.visa_in ?? 0) +
                                          (summary.instapay_collected ?? summary.instapay_in ?? 0);
                                        const totalDiff = totalActual - totalExpected;
                                        const diffPositive = totalDiff > 0;
                                        const diffZero = Math.abs(totalDiff) < 0.005;
                                        return (
                                            <>
                                                <div className="flex justify-between items-center px-2">
                                                    <span className="text-sm text-[#BDBDBD]">الإجمالي الفعلي (كل الوسائل):</span>
                                                    <span className="font-bold text-white" dir="ltr">{totalActual.toFixed(2)} EGP</span>
                                                </div>
                                                <div className="flex justify-between items-center px-2 pb-1">
                                                    <span className="text-sm text-[#BDBDBD]">إجمالي الفرق:</span>
                                                    <span className={`font-bold text-base ${diffZero ? 'text-white/40' : diffPositive ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                                                        {!diffZero && (diffPositive ? '+' : '')}{totalDiff.toFixed(2)} EGP
                                                    </span>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            )}


                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setIsCloseModalOpen(false)}
                                    className="flex-1 bg-[#2A2A2A] hover:bg-[#333] text-white py-3 rounded-xl font-bold transition-colors"
                                >
                                    إلغاء
                                </button>
                                <button
                                    onClick={submitCloseDay}
                                    disabled={isClosing || !actualCashStr}
                                    className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white py-3 rounded-xl font-bold transition-colors flex items-center justify-center"
                                >
                                    {isClosing ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'تأكيد الإقفال'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Expenses Modal ── */}
            {showExpensesModal && (
                <div
                    className="mini-modal-overlay"
                    onClick={() => setShowExpensesModal(false)}
                >
                    <div
                        className="mini-modal-panel-static bg-[#1c1c1c] w-full max-w-[450px] rounded-2xl p-6 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex justify-between items-center mb-6 sticky top-0 bg-[#1c1c1c] z-10 pb-4 border-b border-white/5">
                            <h2 className="text-lg font-bold text-white">تفاصيل المصروفات</h2>
                            <button
                                onClick={() => setShowExpensesModal(false)}
                                className="text-[#BDBDBD] hover:text-white transition-colors text-2xl leading-none"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Expenses List */}
                        <div className="mini-scroll-y custom-scrollbar pr-1">
                        {expensesLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="w-8 h-8 border-4 border-[#E6D690]/20 border-t-[#E6D690] rounded-full animate-spin" />
                            </div>
                        ) : expenses.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-[#BDBDBD] text-sm">لا توجد مصروفات لهذا اليوم</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {expenses.map((exp) => {
                                    // Format date with fallback to created_at or expense_date
                                    const expenseDate = exp.expense_date || exp.created_at || exp.date;
                                    let formattedDate = 'بدون تاريخ';
                                    
                                    if (expenseDate) {
                                        try {
                                            const dateObj = new Date(expenseDate);
                                            if (!isNaN(dateObj.getTime())) {
                                                formattedDate = dateObj.toLocaleString('ar-EG', {
                                                    timeZone: 'Africa/Cairo',
                                                    year: 'numeric',
                                                    month: '2-digit',
                                                    day: '2-digit',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                });
                                            }
                                        } catch (e) {
                                            console.error('Date parsing error:', e);
                                        }
                                    }

                                    // Get readable label for expense from API category field
                                    const expenseLabel = getExpenseLabel(exp);
                                    
                                    // Get notes with fallback to description
                                    const expenseNotes = exp.notes || exp.description || 'بدون ملاحظة';
                                    
                                    return (
                                        <div
                                            key={exp.id}
                                            className="bg-[#2a2a2a] hover:bg-[#333] p-4 rounded-xl flex justify-between items-center transition-colors border border-white/5"
                                        >
                                            <div className="flex flex-col gap-1 flex-1">
                                                <p className="text-sm font-bold text-white">
                                                    {expenseLabel}
                                                </p>
                                                <p className="text-xs text-[#BDBDBD] opacity-75">
                                                    {expenseNotes}
                                                </p>
                                                <p className="text-xs text-[#666]">
                                                    {formattedDate}
                                                </p>
                                            </div>
                                            <p className="font-bold text-rose-400 ml-4" dir="ltr">
                                                {(exp.amount ?? 0).toFixed(2)} ج.م
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Summary Footer */}
                        {!expensesLoading && expenses.length > 0 && (
                            <div className="mt-6 pt-4 border-t border-white/5">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm font-bold text-white">الإجمالي</span>
                                    <p className="font-bold text-lg text-rose-400" dir="ltr">
                                        {expenses.reduce((sum, exp) => sum + exp.amount, 0).toFixed(2)} ج.م
                                    </p>
                                </div>
                            </div>
                        )}
                        </div>
                    </div>
                </div>
            )}

        </div>
        </div>
    );
};

export default MiniTreasuryPage;
