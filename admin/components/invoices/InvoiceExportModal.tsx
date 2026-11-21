import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Download,
  FileSpreadsheet,
  RefreshCw,
  RotateCcw,
  Search,
  X
} from 'lucide-react';
import adminApi from '../../api/client';
import { getTodayISO } from '../../utils/dateFormatter';
import {
  Branch,
  InvoiceExportColumnDefinition,
  InvoiceExportColumnKey,
  InvoiceExportPaymentMethodFilter,
  InvoiceExportRequestPayload,
  InvoiceExportStatusFilter,
  InvoiceExportTypeFilter
} from '../../types';

const INVOICE_EXPORT_COLUMNS_STORAGE_KEY = 'admin.invoiceExport.columns.v1';
const INVOICE_EXPORT_MAX_COLUMNS = 25;

const INVOICE_EXPORT_COLUMN_DEFINITIONS: InvoiceExportColumnDefinition[] = [
  { key: 'invoice_number', label: 'رقم الفاتورة', category: 'invoice', description: 'الرقم المعتمد للفاتورة' },
  { key: 'business_day_id', label: 'رقم اليومية', category: 'invoice', description: 'مرجع اليومية التشغيلية' },
  { key: 'invoice_date', label: 'تاريخ الفاتورة', category: 'invoice' },
  { key: 'invoice_time', label: 'وقت الفاتورة', category: 'invoice' },
  { key: 'branch', label: 'الفرع', category: 'invoice' },
  { key: 'type', label: 'نوع الفاتورة', category: 'invoice' },
  { key: 'status', label: 'الحالة', category: 'invoice' },
  { key: 'payment_method', label: 'طريقة الدفع', category: 'invoice' },
  { key: 'created_at', label: 'تاريخ الإنشاء', category: 'invoice' },
  { key: 'customer_name', label: 'اسم العميل', category: 'people' },
  { key: 'customer_phone', label: 'هاتف العميل', category: 'people' },
  { key: 'cashier', label: 'الكاشير', category: 'people' },
  { key: 'barbers', label: 'المصففون', category: 'people', description: 'جميع المصففين المرتبطين بالخدمات داخل الفاتورة' },
  { key: 'barber_count', label: 'عدد المصففين', category: 'people' },
  { key: 'subtotal', label: 'الإجمالي قبل الخصم', category: 'financial' },
  { key: 'discount_amount', label: 'الخصم', category: 'financial' },
  { key: 'deposit_applied', label: 'عربون مطبق سابقًا', category: 'financial', description: 'مال محصل سابقًا وليس خصمًا' },
  { key: 'new_collection', label: 'التحصيل الجديد', category: 'financial', description: 'المحصل عند تسوية الفاتورة' },
  { key: 'final_total', label: 'الصافي', category: 'financial' },
  { key: 'cash_paid', label: 'المتحصل نقداً', category: 'financial' },
  { key: 'visa_paid', label: 'المتحصل فيزا', category: 'financial' },
  { key: 'instapay_paid', label: 'المتحصل إنستا باي', category: 'financial' },
  { key: 'net_collected', label: 'إجمالي المتحصل', category: 'financial' },
  { key: 'promo_code', label: 'كود الخصم', category: 'financial', description: 'كود الخصم الترويجي المستخدم' },
  { key: 'promo_discount', label: 'خصم الكود', category: 'financial', description: 'القيمة المالية لخصم الكود' },
  { key: 'promo_type', label: 'نوع كود الخصم', category: 'financial', description: 'نسبة مئوية أو مبلغ ثابت' },
  { key: 'promo_eligible_subtotal', label: 'المبلغ المؤهل للخصم', category: 'financial', description: 'إجمالي الخدمات المؤهلة للخصم' }
];

const INVOICE_EXPORT_DEFAULT_COLUMNS: InvoiceExportColumnKey[] = [
  'invoice_number',
  'invoice_date',
  'invoice_time',
  'branch',
  'customer_name',
  'customer_phone',
  'cashier',
  'barbers',
  'type',
  'status',
  'payment_method',
  'subtotal',
  'discount_amount',
  'final_total',
  'deposit_applied',
  'new_collection',
  'cash_paid',
  'visa_paid',
  'instapay_paid',
  'net_collected'
];

const COLUMN_GROUP_LABELS: Record<InvoiceExportColumnDefinition['category'], string> = {
  invoice: 'بيانات الفاتورة',
  people: 'العميل والموظفون',
  financial: 'البيانات المالية'
};

const TYPE_OPTIONS: Array<{ value: InvoiceExportTypeFilter; label: string }> = [
  { value: 'جميع الفواتير', label: 'جميع الفواتير' },
  { value: 'عادية', label: 'عادية' },
  { value: 'بخصم', label: 'بخصم' },
  { value: 'معلقة', label: 'معلقة' }
];

const STATUS_OPTIONS: Array<{ value: InvoiceExportStatusFilter; label: string }> = [
  { value: 'PAID', label: 'مدفوعة' },
  { value: 'DRAFT', label: 'مسودة نشطة' },
  { value: 'DRAFT_COMMITTED', label: 'معلقة / متروكة' },
  { value: 'CANCELED', label: 'ملغاة' }
];

const PAYMENT_METHOD_OPTIONS: Array<{ value: InvoiceExportPaymentMethodFilter; label: string }> = [
  { value: 'CASH', label: 'كاش' },
  { value: 'VISA', label: 'فيزا' },
  { value: 'INSTAPAY', label: 'إنستا باي' }
];

interface InvoiceExportEmployeeOption {
  id: number;
  name: string;
  branchName?: string | null;
}

interface InvoiceExportDraft {
  dateFrom: string;
  dateTo: string;
  branchId: string;
  barberId: string;
  cashierId: string;
  businessDayId: string;
  paymentMethod: '' | InvoiceExportPaymentMethodFilter;
  type: InvoiceExportTypeFilter;
  status: '' | InvoiceExportStatusFilter;
  search: string;
  columns: InvoiceExportColumnKey[];
}

interface InvoiceExportModalProps {
  isOpen: boolean;
  isDarkMode: boolean;
  selectedBranch: string;
  initialDateFrom: string;
  initialDateTo: string;
  initialSearch: string;
  initialBusinessDayId: string;
  initialType: InvoiceExportTypeFilter;
  initialPaymentMethod?: '' | InvoiceExportPaymentMethodFilter;
  isSubmitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onSubmit: (payload: InvoiceExportRequestPayload) => void;
}

const isValidIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseIsoDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatIsoDate = (value: Date) => {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const shiftIsoDate = (value: string, days: number) => {
  const nextDate = parseIsoDate(value);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return formatIsoDate(nextDate);
};

const getCurrentMonthStart = (todayIso: string) => `${todayIso.slice(0, 7)}-01`;

const getPreviousMonthRange = (todayIso: string) => {
  const currentMonthStart = parseIsoDate(getCurrentMonthStart(todayIso));
  currentMonthStart.setUTCDate(0);
  const previousMonthEnd = currentMonthStart;
  const previousMonthStart = new Date(Date.UTC(previousMonthEnd.getUTCFullYear(), previousMonthEnd.getUTCMonth(), 1));
  return {
    dateFrom: formatIsoDate(previousMonthStart),
    dateTo: formatIsoDate(previousMonthEnd)
  };
};

const readStoredColumns = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(INVOICE_EXPORT_COLUMNS_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const normalized = parsed.filter((value): value is InvoiceExportColumnKey =>
      INVOICE_EXPORT_COLUMN_DEFINITIONS.some((column) => column.key === value)
    );

    return normalized.length > 0 ? normalized.slice(0, INVOICE_EXPORT_MAX_COLUMNS) : null;
  } catch {
    return null;
  }
};

const writeStoredColumns = (columns: InvoiceExportColumnKey[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(INVOICE_EXPORT_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
};

const resolveInitialDateRange = (dateFrom: string, dateTo: string) => {
  const todayIso = getTodayISO();
  if (isValidIsoDate(dateFrom) && isValidIsoDate(dateTo) && dateFrom <= dateTo) {
    return { dateFrom, dateTo };
  }

  return {
    dateFrom: getCurrentMonthStart(todayIso),
    dateTo: todayIso
  };
};

const resolveInitialColumns = () => readStoredColumns() || INVOICE_EXPORT_DEFAULT_COLUMNS;

const buildInitialDraft = ({
  selectedBranch,
  initialDateFrom,
  initialDateTo,
  initialSearch,
  initialBusinessDayId,
  initialType,
  initialPaymentMethod
}: Pick<InvoiceExportModalProps, 'selectedBranch' | 'initialDateFrom' | 'initialDateTo' | 'initialSearch' | 'initialBusinessDayId' | 'initialType' | 'initialPaymentMethod'>): InvoiceExportDraft => {
  const normalizedRange = resolveInitialDateRange(initialDateFrom, initialDateTo);

  return {
    dateFrom: normalizedRange.dateFrom,
    dateTo: normalizedRange.dateTo,
    branchId: selectedBranch === 'All' ? 'all' : selectedBranch,
    barberId: '',
    cashierId: '',
    businessDayId: initialBusinessDayId.trim(),
    paymentMethod: initialPaymentMethod || '',
    type: initialType,
    status: '',
    search: initialSearch.trim(),
    columns: resolveInitialColumns()
  };
};

const InvoiceExportModal: React.FC<InvoiceExportModalProps> = ({
  isOpen,
  isDarkMode,
  selectedBranch,
  initialDateFrom,
  initialDateTo,
  initialSearch,
  initialBusinessDayId,
  initialType,
  initialPaymentMethod = '',
  isSubmitting,
  submitError,
  onClose,
  onSubmit
}) => {
  const titleId = useId();
  const errorId = useId();
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [barberOptions, setBarberOptions] = useState<InvoiceExportEmployeeOption[]>([]);
  const [cashierOptions, setCashierOptions] = useState<InvoiceExportEmployeeOption[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [columnLimitMessage, setColumnLimitMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<InvoiceExportDraft>(() => buildInitialDraft({
    selectedBranch,
    initialDateFrom,
    initialDateTo,
    initialSearch,
    initialBusinessDayId,
    initialType,
    initialPaymentMethod: initialPaymentMethod as '' | InvoiceExportPaymentMethodFilter
  }));

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDraft(buildInitialDraft({
      selectedBranch,
      initialDateFrom,
      initialDateTo,
      initialSearch,
      initialBusinessDayId,
      initialType,
      initialPaymentMethod: initialPaymentMethod as '' | InvoiceExportPaymentMethodFilter
    }));
    setOptionsError(null);
    setColumnLimitMessage(null);
  }, [isOpen, selectedBranch, initialDateFrom, initialDateTo, initialSearch, initialBusinessDayId, initialType, initialPaymentMethod]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const requestId = window.requestAnimationFrame(() => {
      firstInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(requestId);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSubmitting, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = documentElement.style.overflow;

    body.style.overflow = 'hidden';
    documentElement.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isCancelled = false;

    const fetchBranches = async () => {
      setIsLoadingOptions(true);
      setOptionsError(null);

      try {
        const response = await adminApi.get('/branches', {
          params: { exclude_main_warehouse: true }
        });

        if (isCancelled) {
          return;
        }

        const nextBranches: Branch[] = Array.isArray(response.data) ? response.data : [];
        setBranches(nextBranches);

        if (nextBranches.length === 1) {
          setDraft((current) => ({
            ...current,
            branchId: String(nextBranches[0].id)
          }));
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error('Failed to load export branches:', error);
        setOptionsError('تعذر تحميل خيارات التصفية. يمكنك المتابعة بالفلاتر الحالية أو إعادة المحاولة.');
      } finally {
        if (!isCancelled) {
          setIsLoadingOptions(false);
        }
      }
    };

    fetchBranches();

    return () => {
      isCancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isCancelled = false;

    const fetchEmployees = async () => {
      setIsLoadingOptions(true);
      setOptionsError(null);

      try {
        const branchParam = draft.branchId && draft.branchId !== 'all' ? draft.branchId : undefined;

        const [barbersResponse, cashiersResponse] = await Promise.all([
          adminApi.get('/employees', {
            params: {
              branch_id: branchParam,
              role: 'BARBER',
              is_active: true
            }
          }),
          adminApi.get('/employees', {
            params: {
              branch_id: branchParam,
              role: 'CASHIER',
              is_active: true
            }
          })
        ]);

        if (isCancelled) {
          return;
        }

        const mapEmployees = (employees: any[]): InvoiceExportEmployeeOption[] => employees.map((employee) => ({
          id: employee.id,
          name: employee.full_name,
          branchName: employee.branch_name
        }));

        setBarberOptions(mapEmployees(Array.isArray(barbersResponse.data) ? barbersResponse.data : []));
        setCashierOptions(mapEmployees(Array.isArray(cashiersResponse.data) ? cashiersResponse.data : []));
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error('Failed to load export employees:', error);
        setOptionsError('تعذر تحميل قائمة المصففين أو الكاشير. يمكنك المتابعة بدون هذه الفلاتر أو إعادة المحاولة.');
      } finally {
        if (!isCancelled) {
          setIsLoadingOptions(false);
        }
      }
    };

    fetchEmployees();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, draft.branchId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    writeStoredColumns(draft.columns);
  }, [draft.columns, isOpen]);

  const branchOptions = useMemo(() => {
    if (branches.length <= 1) {
      return branches.map((branch) => ({
        value: String(branch.id),
        label: branch.name
      }));
    }

    return [
      { value: 'all', label: 'جميع الفروع المسموح بها' },
      ...branches.map((branch) => ({
        value: String(branch.id),
        label: branch.name
      }))
    ];
  }, [branches]);

  const selectedColumns = useMemo(
    () => draft.columns.map((columnKey) => INVOICE_EXPORT_COLUMN_DEFINITIONS.find((column) => column.key === columnKey)).filter(Boolean) as InvoiceExportColumnDefinition[],
    [draft.columns]
  );

  const groupedColumns = useMemo(() => (
    (['invoice', 'people', 'financial'] as const).map((category) => ({
      category,
      label: COLUMN_GROUP_LABELS[category],
      columns: INVOICE_EXPORT_COLUMN_DEFINITIONS.filter((column) => column.category === category)
    }))
  ), []);

  const validationError = useMemo(() => {
    if (!draft.dateFrom || !draft.dateTo) {
      return 'اختر تاريخ البداية وتاريخ النهاية قبل بدء التصدير.';
    }

    if (!isValidIsoDate(draft.dateFrom) || !isValidIsoDate(draft.dateTo)) {
      return 'صيغة التاريخ يجب أن تكون YYYY-MM-DD.';
    }

    if (draft.dateFrom > draft.dateTo) {
      return 'تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية.';
    }

    if (draft.columns.length === 0) {
      return 'اختر عمودًا واحدًا على الأقل قبل التصدير.';
    }

    if (draft.columns.length > INVOICE_EXPORT_MAX_COLUMNS) {
      return `يمكن إرسال ${INVOICE_EXPORT_MAX_COLUMNS} عمودًا كحد أقصى في كل طلب تصدير.`;
    }

    return null;
  }, [draft.columns.length, draft.dateFrom, draft.dateTo]);

  const handleFieldChange = <K extends keyof InvoiceExportDraft>(field: K, value: InvoiceExportDraft[K]) => {
    setDraft((current) => ({
      ...current,
      [field]: value
    }));
  };

  const toggleColumn = (columnKey: InvoiceExportColumnKey) => {
    if (isSubmitting) {
      return;
    }

    if (draft.columns.includes(columnKey)) {
      setColumnLimitMessage(null);
      setDraft((current) => ({
        ...current,
        columns: current.columns.filter((value) => value !== columnKey)
      }));
      return;
    }

    if (draft.columns.length >= INVOICE_EXPORT_MAX_COLUMNS) {
      setColumnLimitMessage(`يمكن اختيار ${INVOICE_EXPORT_MAX_COLUMNS} عمودًا كحد أقصى لكل عملية تصدير.`);
      return;
    }

    setColumnLimitMessage(null);
    setDraft((current) => ({
      ...current,
      columns: [...current.columns, columnKey]
    }));
  };

  const handleSelectAll = () => {
    if (isSubmitting) {
      return;
    }

    setColumnLimitMessage(
      INVOICE_EXPORT_COLUMN_DEFINITIONS.length > INVOICE_EXPORT_MAX_COLUMNS
        ? `تم تحديد ${INVOICE_EXPORT_MAX_COLUMNS} عمودًا وهو الحد الأقصى الحالي للتصدير.`
        : null
    );
    setDraft((current) => ({
      ...current,
      columns: INVOICE_EXPORT_COLUMN_DEFINITIONS.slice(0, INVOICE_EXPORT_MAX_COLUMNS).map((column) => column.key)
    }));
  };

  const handleClearAll = () => {
    if (isSubmitting) {
      return;
    }

    setColumnLimitMessage(null);
    setDraft((current) => ({
      ...current,
      columns: []
    }));
  };

  const handleRestoreDefaults = () => {
    if (isSubmitting) {
      return;
    }

    setColumnLimitMessage(null);
    setDraft((current) => ({
      ...current,
      columns: [...INVOICE_EXPORT_DEFAULT_COLUMNS]
    }));
  };

  const moveColumn = (columnKey: InvoiceExportColumnKey, direction: 'up' | 'down') => {
    if (isSubmitting) {
      return;
    }

    setDraft((current) => {
      const currentIndex = current.columns.indexOf(columnKey);
      if (currentIndex === -1) {
        return current;
      }

      const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= current.columns.length) {
        return current;
      }

      const nextColumns = [...current.columns];
      const [movedColumn] = nextColumns.splice(currentIndex, 1);
      nextColumns.splice(nextIndex, 0, movedColumn);

      return {
        ...current,
        columns: nextColumns
      };
    });
  };

  const applyPreset = (preset: 'today' | 'last7' | 'currentMonth' | 'previousMonth') => {
    const todayIso = getTodayISO();

    if (preset === 'today') {
      setDraft((current) => ({
        ...current,
        dateFrom: todayIso,
        dateTo: todayIso
      }));
      return;
    }

    if (preset === 'last7') {
      setDraft((current) => ({
        ...current,
        dateFrom: shiftIsoDate(todayIso, -6),
        dateTo: todayIso
      }));
      return;
    }

    if (preset === 'currentMonth') {
      setDraft((current) => ({
        ...current,
        dateFrom: getCurrentMonthStart(todayIso),
        dateTo: todayIso
      }));
      return;
    }

    const previousMonthRange = getPreviousMonthRange(todayIso);
    setDraft((current) => ({
      ...current,
      dateFrom: previousMonthRange.dateFrom,
      dateTo: previousMonthRange.dateTo
    }));
  };

  const handleSubmit = () => {
    if (isSubmitting || validationError) {
      return;
    }

    const filters: InvoiceExportRequestPayload['filters'] = {};

    if (draft.branchId && draft.branchId !== 'all') {
      filters.branch_id = Number(draft.branchId);
    }
    if (draft.barberId) {
      filters.barber_id = Number(draft.barberId);
    }
    if (draft.cashierId) {
      filters.cashier_id = Number(draft.cashierId);
    }
    if (draft.businessDayId) {
      filters.business_day_id = Number(draft.businessDayId);
    }
    if (draft.paymentMethod) {
      filters.payment_method = draft.paymentMethod;
    }
    if (draft.type !== 'جميع الفواتير') {
      filters.type = draft.type;
    }
    if (draft.status) {
      filters.status = draft.status;
    }
    if (draft.search.trim()) {
      filters.search = draft.search.trim();
    }

    onSubmit({
      date_from: draft.dateFrom,
      date_to: draft.dateTo,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      columns: draft.columns,
      mode: 'invoice_summary'
    });
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[150] bg-black/65 backdrop-blur-sm" dir="rtl">
      <div
        className="absolute inset-0"
        onClick={() => {
          if (!isSubmitting) {
            onClose();
          }
        }}
      />

      <div
        className="relative z-10 flex min-h-full items-center justify-center p-3 sm:p-6"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`relative flex w-full max-w-5xl max-h-[calc(100dvh-48px)] flex-col overflow-hidden rounded-[1.4rem] border animate-scale-in shadow-2xl ${isDarkMode ? 'bg-[#0F0F0F] border-white/10' : 'bg-white border-black/10'}`}
        >
          <div className={`shrink-0 border-b px-4 py-3 sm:px-5 sm:py-4 ${isDarkMode ? 'border-white/5 bg-[#0F0F0F]' : 'border-black/5 bg-white'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl ${isDarkMode ? 'bg-[#E53935]/15 text-[#E53935]' : 'bg-red-50 text-[#E53935]'}`}>
                  <FileSpreadsheet size={18} />
                </div>
                <div className="text-right">
                  <h2 id={titleId} className={`text-base font-bold sm:text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    تصدير الفواتير
                  </h2>
                  <p className={`mt-1 text-xs font-medium sm:text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    تنزيل ملف Excel من الخادم للفواتير المطابقة للفترة والفلاتر المحددة.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className={`rounded-full p-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${isDarkMode ? 'text-gray-500 hover:bg-white/5' : 'text-gray-400 hover:bg-black/5'}`}
                aria-label="إغلاق نافذة تصدير الفواتير"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
              <section className={`rounded-[1.25rem] border px-3.5 py-3.5 sm:px-4 sm:py-4 ${isDarkMode ? 'border-white/6 bg-white/[0.02]' : 'border-black/5 bg-gray-50/70'}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-gray-500">الفترة</span>
                    <p className={`mt-1.5 text-xs font-semibold sm:text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      للفواتير المدفوعة يُستخدم تاريخ الفاتورة، وللمسودات يُستخدم تاريخ إنشائها.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => applyPreset('today')} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${isDarkMode ? 'bg-white/5 text-gray-200 hover:bg-white/10' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}>اليوم</button>
                    <button type="button" onClick={() => applyPreset('last7')} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${isDarkMode ? 'bg-white/5 text-gray-200 hover:bg-white/10' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}>آخر 7 أيام</button>
                    <button type="button" onClick={() => applyPreset('currentMonth')} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${isDarkMode ? 'bg-white/5 text-gray-200 hover:bg-white/10' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}>الشهر الحالي</button>
                    <button type="button" onClick={() => applyPreset('previousMonth')} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${isDarkMode ? 'bg-white/5 text-gray-200 hover:bg-white/10' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}>الشهر السابق</button>
                  </div>
                </div>

                <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>من</span>
                    <div className="relative">
                      <input
                        ref={firstInputRef}
                        type="date"
                        value={draft.dateFrom}
                        onChange={(event) => handleFieldChange('dateFrom', event.target.value)}
                        style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                        className={`w-full rounded-xl border px-3.5 py-2.5 pr-10 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                      />
                      <Calendar size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#E53935]" />
                    </div>
                  </label>

                  <label className="space-y-1.5">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>إلى</span>
                    <div className="relative">
                      <input
                        type="date"
                        value={draft.dateTo}
                        onChange={(event) => handleFieldChange('dateTo', event.target.value)}
                        style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                        className={`w-full rounded-xl border px-3.5 py-2.5 pr-10 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                      />
                      <Calendar size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#E53935]" />
                    </div>
                  </label>
                </div>
              </section>

              <section className={`rounded-[1.25rem] border px-3.5 py-3.5 sm:px-4 sm:py-4 ${isDarkMode ? 'border-white/6 bg-white/[0.02]' : 'border-black/5 bg-gray-50/70'}`}>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-gray-500">الفلاتر</span>
                    <p className={`mt-1.5 text-xs font-semibold sm:text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      يمكنك تعديل فلاتر التصدير هنا دون تغيير الفلاتر المرئية في صفحة الفواتير.
                    </p>
                  </div>

                  {isLoadingOptions && (
                    <span className={`flex items-center gap-2 text-[11px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      <RefreshCw size={13} className="animate-spin" />
                      جاري تحميل الخيارات...
                    </span>
                  )}
                </div>

                <div className="mt-3.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1.5 sm:col-span-2 xl:col-span-2">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>البحث</span>
                    <div className="relative">
                      <input
                        type="text"
                        value={draft.search}
                        onChange={(event) => handleFieldChange('search', event.target.value)}
                        placeholder="اسم العميل أو رقم الفاتورة"
                        className={`w-full rounded-xl border px-3.5 py-2.5 pr-10 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                      />
                      <Search size={15} className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                    </div>
                  </label>

                  <label className="space-y-1.5">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>رقم اليومية</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={draft.businessDayId}
                      onChange={(event) => handleFieldChange('businessDayId', event.target.value.replace(/\D/g, ''))}
                      placeholder="مثال: 125"
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>الفرع</span>
                    <select
                      value={draft.branchId}
                      onChange={(event) => handleFieldChange('branchId', event.target.value)}
                      disabled={branchOptions.length === 0}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                    >
                      {branchOptions.map((branch) => (
                        <option key={branch.value} value={branch.value}>{branch.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>المصفف</span>
                    <select
                      value={draft.barberId}
                      onChange={(event) => handleFieldChange('barberId', event.target.value)}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                    >
                      <option value="">كل المصففين</option>
                      {barberOptions.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}{employee.branchName ? ` • ${employee.branchName}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>الكاشير</span>
                    <select
                      value={draft.cashierId}
                      onChange={(event) => handleFieldChange('cashierId', event.target.value)}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                    >
                      <option value="">كل الكاشير</option>
                      {cashierOptions.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}{employee.branchName ? ` • ${employee.branchName}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>طريقة الدفع</span>
                    <select
                      value={draft.paymentMethod}
                      onChange={(event) => handleFieldChange('paymentMethod', event.target.value as InvoiceExportDraft['paymentMethod'])}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                    >
                      <option value="">كل طرق الدفع</option>
                      {PAYMENT_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>نوع الفاتورة</span>
                    <select
                      value={draft.type}
                      onChange={(event) => handleFieldChange('type', event.target.value as InvoiceExportTypeFilter)}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                    >
                      {TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>الحالة</span>
                    <select
                      value={draft.status}
                      onChange={(event) => handleFieldChange('status', event.target.value as InvoiceExportDraft['status'])}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#121212] border-white/8 text-white focus:border-[#E53935]/40' : 'bg-white border-gray-200 text-gray-900 focus:border-[#E53935]/40'}`}
                    >
                      <option value="">كل الحالات</option>
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {optionsError && (
                  <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${isDarkMode ? 'border-amber-500/20 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <span>{optionsError}</span>
                  </div>
                )}
              </section>

              <section className={`rounded-[1.25rem] border px-3.5 py-3.5 sm:px-4 sm:py-4 ${isDarkMode ? 'border-white/6 bg-white/[0.02]' : 'border-black/5 bg-gray-50/70'}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-gray-500">الأعمدة</span>
                    <p className={`mt-1.5 text-xs font-semibold sm:text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      تم اختيار {draft.columns.length} من {INVOICE_EXPORT_MAX_COLUMNS} عمودًا. ترتيب القائمة المختارة هو نفس ترتيب الأعمدة في الملف النهائي.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={handleSelectAll} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${isDarkMode ? 'bg-white/5 text-gray-200 hover:bg-white/10' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}>تحديد الكل</button>
                    <button type="button" onClick={handleClearAll} className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${isDarkMode ? 'bg-white/5 text-gray-200 hover:bg-white/10' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}>مسح الكل</button>
                    <button type="button" onClick={handleRestoreDefaults} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${isDarkMode ? 'bg-white/5 text-gray-200 hover:bg-white/10' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}>
                      <RotateCcw size={12} />
                      استعادة الافتراضي
                    </button>
                  </div>
                </div>

                <div className="mt-3.5 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.82fr)]">
                  <div className="space-y-3">
                    {groupedColumns.map((group) => (
                      <div key={group.category} className={`rounded-[1.1rem] border px-3 py-3 ${isDarkMode ? 'border-white/6 bg-[#111111]' : 'border-black/5 bg-white'}`}>
                        <h3 className={`text-sm font-black ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{group.label}</h3>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {group.columns.map((column) => {
                            const isChecked = draft.columns.includes(column.key);
                            return (
                              <button
                                key={column.key}
                                type="button"
                                onClick={() => toggleColumn(column.key)}
                                aria-pressed={isChecked}
                                className={`flex min-h-[52px] items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-right transition-all ${isChecked
                                  ? isDarkMode
                                    ? 'border-[#E53935]/35 bg-[#E53935]/10'
                                    : 'border-[#E53935]/20 bg-red-50'
                                  : isDarkMode
                                    ? 'border-white/6 bg-white/[0.02]'
                                    : 'border-black/5 bg-gray-50/70'
                                }`}
                              >
                                <div>
                                  <div className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{column.label}</div>
                                  {column.description && (
                                    <div className={`mt-0.5 text-[11px] font-medium leading-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                      {column.description}
                                    </div>
                                  )}
                                </div>
                                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-black transition-all ${isChecked
                                  ? 'border-[#E53935] bg-[#E53935] text-white'
                                  : isDarkMode
                                    ? 'border-white/12 text-transparent'
                                    : 'border-black/10 text-transparent'
                                }`}>
                                  ✓
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={`rounded-[1.1rem] border px-3 py-3 ${isDarkMode ? 'border-white/6 bg-[#111111]' : 'border-black/5 bg-white'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className={`text-sm font-black ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>ترتيب الأعمدة المختارة</h3>
                      <span className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {draft.columns.length} عمود
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {selectedColumns.length === 0 ? (
                        <div className={`rounded-xl border border-dashed px-3 py-5 text-center text-sm font-bold ${isDarkMode ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
                          اختر عمودًا واحدًا على الأقل لعرض الترتيب هنا.
                        </div>
                      ) : (
                        selectedColumns.map((column, index) => (
                          <div key={column.key} className={`flex min-h-[48px] items-center justify-between gap-3 rounded-xl border px-3 py-2 ${isDarkMode ? 'border-white/6 bg-white/[0.02]' : 'border-black/5 bg-gray-50/70'}`}>
                            <div className="min-w-0">
                              <div className={`truncate text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{column.label}</div>
                              <div className={`mt-0.5 text-[11px] font-semibold ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                #{index + 1}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => moveColumn(column.key, 'up')}
                                disabled={index === 0}
                                aria-label={`نقل ${column.label} إلى أعلى`}
                                className={`rounded-lg border p-2 transition-all disabled:cursor-not-allowed disabled:opacity-40 ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-gray-200 text-gray-700 hover:bg-white'}`}
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveColumn(column.key, 'down')}
                                disabled={index === selectedColumns.length - 1}
                                aria-label={`نقل ${column.label} إلى أسفل`}
                                className={`rounded-lg border p-2 transition-all disabled:cursor-not-allowed disabled:opacity-40 ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-gray-200 text-gray-700 hover:bg-white'}`}
                              >
                                <ArrowDown size={13} />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div className={`shrink-0 border-t px-4 py-3 sm:px-5 sm:py-4 ${isDarkMode ? 'border-white/5 bg-[#0F0F0F]' : 'border-black/5 bg-white'}`}>
            <div aria-live="assertive" id={errorId} className="space-y-2.5">
              {validationError && (
                <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${isDarkMode ? 'border-amber-500/20 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}

              {!validationError && columnLimitMessage && (
                <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${isDarkMode ? 'border-amber-500/20 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{columnLimitMessage}</span>
                </div>
              )}

              {submitError && (
                <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${isDarkMode ? 'border-red-500/20 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <span className={`text-[11px] font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  سيتم تصدير جميع الفواتير المطابقة للفترة والفلاتر المحددة.
                </span>
                <span className={`text-[11px] font-semibold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {isSubmitting ? 'جاري تجهيز ملف الفواتير...' : 'سيبدأ التنزيل فور تجهيز الملف من الخادم.'}
                </span>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className={`w-full rounded-xl border px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.22em] transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-gray-900 hover:bg-black/5'}`}
                >
                  إلغاء
                </button>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting || Boolean(validationError)}
                  aria-describedby={validationError || submitError ? errorId : undefined}
                  className="w-full rounded-xl bg-[#E53935] px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.28em] text-white shadow-2xl shadow-red-900/20 transition-all hover:bg-[#FF3B30] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {isSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <RefreshCw size={14} className="animate-spin" />
                      جاري التجهيز...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Download size={14} />
                      تنزيل الملف
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceExportModal;
