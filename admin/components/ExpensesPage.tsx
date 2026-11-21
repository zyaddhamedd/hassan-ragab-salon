import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Calendar,
    Download,
    Plus,
    X,
    Save,
    AlertCircle,
    TrendingDown,
    Building2,
    FileText,
    User,
    StickyNote,
    ChevronDown,
    ServerCrash,
    RefreshCw,
    Trash2,
} from 'lucide-react';
import {
    ExpenseCategory,
    ExpenseListResponse,
    ExpenseRecord,
    ExpenseSummaryResponse,
} from '../types';
import adminApi from '../api/client';
import { downloadBlob, getFilenameFromContentDisposition } from '../utils/fileDownload';
import { getTodayISO } from '../utils/dateFormatter';

interface ExpensesPageProps {
    isDarkMode: boolean;
    selectedBranch: string;
}

const PAGE_SIZE = 25;
const ALL_CATEGORIES_VALUE = 'All';
const REQUEST_CACHE_TTL_MS = 1500;

const buildDefaultDateRange = () => {
    const today = getTodayISO();
    return {
        start: `${today.slice(0, 8)}01`,
        end: today,
    };
};

const EMPTY_SUMMARY: ExpenseSummaryResponse = {
    total_amount: 0,
    today_amount: 0,
    count: 0,
};

const expenseCategoryInflight = new Map<string, Promise<ExpenseCategory[]>>();
const expenseListInflight = new Map<string, Promise<ExpenseListResponse>>();
const expenseSummaryInflight = new Map<string, Promise<ExpenseSummaryResponse>>();

const expenseCategoryCache = new Map<string, { data: ExpenseCategory[]; expiresAt: number }>();
const expenseListCache = new Map<string, { data: ExpenseListResponse; expiresAt: number }>();
const expenseSummaryCache = new Map<string, { data: ExpenseSummaryResponse; expiresAt: number }>();

const getCachedValue = <T,>(cache: Map<string, { data: T; expiresAt: number }>, key: string): T | null => {
    const cached = cache.get(key);
    if (!cached) {
        return null;
    }

    if (cached.expiresAt < Date.now()) {
        cache.delete(key);
        return null;
    }

    return cached.data;
};

const rememberCachedValue = <T,>(cache: Map<string, { data: T; expiresAt: number }>, key: string, data: T) => {
    cache.set(key, {
        data,
        expiresAt: Date.now() + REQUEST_CACHE_TTL_MS,
    });
};

const parseExportErrorMessage = async (error: any): Promise<string> => {
    const responseData = error?.response?.data;

    if (responseData instanceof Blob) {
        try {
            const text = await responseData.text();
            if (!text) {
                return 'تعذر تصدير المصروفات. حاول مرة أخرى.';
            }

            try {
                const parsed = JSON.parse(text);
                return parsed.error || parsed.message || parsed.details || 'تعذر تصدير المصروفات. حاول مرة أخرى.';
            } catch {
                return text;
            }
        } catch {
            return 'تعذر تصدير المصروفات. حاول مرة أخرى.';
        }
    }

    return error?.response?.data?.error || error?.response?.data?.message || error?.message || 'تعذر تصدير المصروفات. حاول مرة أخرى.';
};

const ExpensesPage: React.FC<ExpensesPageProps> = ({ isDarkMode, selectedBranch }) => {
    const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [selectedCategoryId, setSelectedCategoryId] = useState(ALL_CATEGORIES_VALUE);
    const [dateRange, setDateRange] = useState(buildDefaultDateRange);
    const [categoryModalOpen, setCategoryModalOpen] = useState(false);
    const [newCategory, setNewCategory] = useState({ name: '', description: '', isActive: true });

    const [summary, setSummary] = useState<ExpenseSummaryResponse>(EMPTY_SUMMARY);
    const [pagination, setPagination] = useState({
        page: 1,
        per_page: PAGE_SIZE,
        total: 0,
        total_pages: 0,
        has_more: false,
    });
    const [currentPage, setCurrentPage] = useState(1);

    const [isCategoriesLoading, setIsCategoriesLoading] = useState(true);
    const [isInitialListLoading, setIsInitialListLoading] = useState(true);
    const [isPageLoading, setIsPageLoading] = useState(false);
    const [isSummaryLoading, setIsSummaryLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false);
    const [hasLoadedListOnce, setHasLoadedListOnce] = useState(false);

    const [listError, setListError] = useState<string | null>(null);
    const [summaryError, setSummaryError] = useState<string | null>(null);

    const listRequestSeqRef = useRef(0);
    const summaryRequestSeqRef = useRef(0);

    const requestParams = useMemo(() => ({
        branch_id: selectedBranch !== 'All' ? selectedBranch : undefined,
        category_id: selectedCategoryId !== ALL_CATEGORIES_VALUE ? selectedCategoryId : undefined,
        date_from: dateRange.start || undefined,
        date_to: dateRange.end || undefined,
    }), [dateRange.end, dateRange.start, selectedBranch, selectedCategoryId]);

    const activeCategories = useMemo(
        () => categories.filter(category => category.is_active !== false),
        [categories]
    );

    const fetchCategories = async () => {
        setIsCategoriesLoading(true);
        try {
            const requestKey = 'expense-categories';
            const cached = getCachedValue(expenseCategoryCache, requestKey);
            if (cached) {
                setCategories(cached);
                return;
            }

            let request = expenseCategoryInflight.get(requestKey);
            if (!request) {
                request = adminApi.get<ExpenseCategory[]>('/expense-categories')
                    .then((response) => Array.isArray(response.data) ? response.data : [])
                    .then((data) => {
                        rememberCachedValue(expenseCategoryCache, requestKey, data);
                        return data;
                    })
                    .finally(() => {
                        expenseCategoryInflight.delete(requestKey);
                    });
                expenseCategoryInflight.set(requestKey, request);
            }

            setCategories(await request);
        } catch (error) {
            console.error('Failed to fetch expense categories:', error);
            setCategories([]);
        } finally {
            setIsCategoriesLoading(false);
        }
    };

    const fetchExpensesPage = async (page: number) => {
        const requestSeq = ++listRequestSeqRef.current;
        const requestKey = JSON.stringify({ ...requestParams, page, per_page: PAGE_SIZE });
        setListError(null);

        if (!hasLoadedListOnce) {
            setIsInitialListLoading(true);
        } else {
            setIsPageLoading(true);
        }

        try {
            const cached = getCachedValue(expenseListCache, requestKey);
            let payload: ExpenseListResponse;
            if (cached) {
                payload = cached;
            } else {
                let request = expenseListInflight.get(requestKey);
                if (!request) {
                    request = adminApi.get<ExpenseListResponse>('/expenses', {
                        params: {
                            ...requestParams,
                            page,
                            per_page: PAGE_SIZE,
                        },
                    })
                        .then((response) => response.data)
                        .then((data) => {
                            rememberCachedValue(expenseListCache, requestKey, data);
                            return data;
                        })
                        .finally(() => {
                            expenseListInflight.delete(requestKey);
                        });
                    expenseListInflight.set(requestKey, request);
                }

                payload = await request;
            }

            if (requestSeq !== listRequestSeqRef.current) {
                return;
            }

            setExpenses(Array.isArray(payload.items) ? payload.items : []);
            setPagination({
                page: payload.page ?? page,
                per_page: payload.per_page ?? PAGE_SIZE,
                total: payload.total ?? 0,
                total_pages: payload.total_pages ?? 0,
                has_more: Boolean(payload.has_more),
            });
            setCurrentPage(payload.page ?? page);
            setHasLoadedListOnce(true);
        } catch (err: any) {
            if (requestSeq !== listRequestSeqRef.current) {
                return;
            }

            console.error('Failed to fetch expenses:', err);
            setListError(
                err.response?.status === 404
                    ? 'Backend Endpoint Missing: GET /api/admin/expenses'
                    : err.response?.data?.error || err.message || 'Failed to load expenses'
            );
            setExpenses([]);
            setPagination({
                page,
                per_page: PAGE_SIZE,
                total: 0,
                total_pages: 0,
                has_more: false,
            });
        } finally {
            if (requestSeq !== listRequestSeqRef.current) {
                return;
            }

            setIsInitialListLoading(false);
            setIsPageLoading(false);
        }
    };

    const fetchSummary = async () => {
        const requestSeq = ++summaryRequestSeqRef.current;
        const requestKey = JSON.stringify(requestParams);
        setIsSummaryLoading(true);
        setSummaryError(null);

        try {
            const cached = getCachedValue(expenseSummaryCache, requestKey);
            let payload: ExpenseSummaryResponse;
            if (cached) {
                payload = cached;
            } else {
                let request = expenseSummaryInflight.get(requestKey);
                if (!request) {
                    request = adminApi.get<ExpenseSummaryResponse>('/expenses/summary', {
                        params: requestParams,
                    })
                        .then((response) => response.data)
                        .then((data) => {
                            rememberCachedValue(expenseSummaryCache, requestKey, data);
                            return data;
                        })
                        .finally(() => {
                            expenseSummaryInflight.delete(requestKey);
                        });
                    expenseSummaryInflight.set(requestKey, request);
                }

                payload = await request;
            }

            if (requestSeq !== summaryRequestSeqRef.current) {
                return;
            }

            setSummary({
                total_amount: Number(payload.total_amount || 0),
                today_amount: Number(payload.today_amount || 0),
                count: Number(payload.count || 0),
            });
        } catch (err: any) {
            if (requestSeq !== summaryRequestSeqRef.current) {
                return;
            }

            console.error('Failed to fetch expense summary:', err);
            setSummary(EMPTY_SUMMARY);
            setSummaryError(
                err.response?.status === 404
                    ? 'Backend Endpoint Missing: GET /api/admin/expenses/summary'
                    : err.response?.data?.error || err.message || 'Failed to load summary'
            );
        } finally {
            if (requestSeq !== summaryRequestSeqRef.current) {
                return;
            }

            setIsSummaryLoading(false);
        }
    };

    useEffect(() => {
        fetchCategories();
    }, []);

    useEffect(() => {
        if (
            selectedCategoryId !== ALL_CATEGORIES_VALUE &&
            !activeCategories.some(category => String(category.id) === selectedCategoryId)
        ) {
            setSelectedCategoryId(ALL_CATEGORIES_VALUE);
        }
    }, [activeCategories, selectedCategoryId]);

    useEffect(() => {
        setCurrentPage(1);
    }, [selectedBranch, selectedCategoryId, dateRange.start, dateRange.end]);

    useEffect(() => {
        fetchExpensesPage(currentPage);
    }, [currentPage, requestParams]);

    useEffect(() => {
        fetchSummary();
    }, [requestParams]);

    const handleAddCategory = async () => {
        if (!newCategory.name.trim()) {
            return;
        }

        try {
            await adminApi.post('/expense-categories', {
                name: newCategory.name.trim(),
                description: newCategory.description.trim(),
                is_active: newCategory.isActive,
            });

            await fetchCategories();
            setCategoryModalOpen(false);
            setNewCategory({ name: '', description: '', isActive: true });
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to create category');
        }
    };

    const handleDeleteCategory = async (category: ExpenseCategory) => {
        if (!window.confirm(`هل أنت متأكد من حذف ${category.name}؟`)) {
            return;
        }

        try {
            await adminApi.delete(`/expense-categories/${category.id}`);
            if (selectedCategoryId === String(category.id)) {
                setSelectedCategoryId(ALL_CATEGORIES_VALUE);
            }
            await fetchCategories();
        } catch (err) {
            console.error('Failed to delete category', err);
            alert('فشل حذف الفئة');
        }
    };

    const handleExport = async () => {
        if (isExporting) {
            return;
        }

        if (summary.count === 0) {
            alert('لا توجد بيانات للتصدير');
            return;
        }

        setIsExporting(true);
        try {
            const response = await adminApi.post(
                '/expenses/export/xlsx',
                requestParams,
                { responseType: 'blob' }
            );

            const filename = getFilenameFromContentDisposition(response.headers['content-disposition']) || `Expenses_${getTodayISO()}.xlsx`;
            const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
            downloadBlob(blob, filename);
        } catch (err: any) {
            console.error('Failed to export expenses:', err);
            alert(await parseExportErrorMessage(err));
        } finally {
            setIsExporting(false);
        }
    };

    const handleRetryAll = async () => {
        await Promise.all([fetchExpensesPage(currentPage), fetchSummary()]);
    };

    if (listError && !hasLoadedListOnce) {
        return (
            <div className="admin-page-shell animate-fade-in-up lg:px-8">
                <div className={`p-12 rounded-[3rem] border-2 border-dashed flex flex-col items-center justify-center text-center gap-6 ${isDarkMode ? 'border-red-500/20 bg-red-500/5' : 'border-red-500/20 bg-red-50'}`}>
                    <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center">
                        <ServerCrash size={32} />
                    </div>
                    <div className="max-w-md">
                        <h2 className={`text-2xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Backend Connection Failed</h2>
                        <p className={`font-mono text-sm opacity-70 mb-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {listError}
                        </p>
                        <div className="flex justify-center gap-3">
                            <button
                                onClick={handleRetryAll}
                                className="px-6 py-3 rounded-xl bg-[#E53935] text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-[#FF3B30] transition-colors"
                            >
                                <RefreshCw size={14} />
                                Retry Connection
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isInitialListLoading) {
        return (
            <div className="admin-page-shell admin-page-state flex items-center justify-center lg:px-8">
                <div className="flex flex-col items-center gap-4 opacity-50">
                    <RefreshCw size={32} className="animate-spin text-[#E53935]" />
                    <span className="text-xs font-bold uppercase tracking-widest">Loading Expenses from Backend...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-page-shell animate-fade-in-up lg:px-8">
            <div className="flex flex-col xl:flex-row justify-end items-start xl:items-center gap-8 mb-10">
                <div className="flex gap-4 w-full xl:w-auto">
                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className={`flex-1 xl:flex-none border px-6 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:cursor-not-allowed disabled:opacity-60 ${isDarkMode ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50'}`}
                    >
                        {isExporting ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
                        {isExporting ? 'جاري التصدير...' : 'تصدير Excel'}
                    </button>
                    <button
                        onClick={() => setCategoryModalOpen(true)}
                        className="flex-1 xl:flex-none bg-[#E53935] hover:bg-[#FF3B30] text-white px-8 py-3.5 rounded-xl text-sm font-bold shadow-lg shadow-red-900/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <Plus size={18} />
                        إضافة نوع مصروف
                    </button>
                </div>
            </div>

            {summaryError && (
                <div className={`mb-6 px-5 py-4 rounded-2xl border text-sm font-bold flex items-center justify-between gap-4 ${isDarkMode ? 'bg-orange-500/5 border-orange-500/20 text-orange-300' : 'bg-orange-50 border-orange-200 text-orange-700'}`}>
                    <div className="flex items-center gap-3">
                        <AlertCircle size={16} />
                        <span>{summaryError}</span>
                    </div>
                    <button
                        onClick={fetchSummary}
                        className="text-xs uppercase tracking-widest opacity-80 hover:opacity-100"
                    >
                        إعادة المحاولة
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div className={`p-6 rounded-[2rem] border relative overflow-hidden group ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#E53935]/5 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-[#E53935]/10"></div>
                    <TrendingDown className="mb-4 text-[#E53935]" size={24} />
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">إجمالي المصروفات</p>
                    <h3 className={`text-3xl font-black ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {isSummaryLoading ? '...' : summary.total_amount.toLocaleString()} <span className="text-sm font-bold opacity-50">ج.م</span>
                    </h3>
                </div>

                <div className={`p-6 rounded-[2rem] border relative overflow-hidden group ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-orange-500/10"></div>
                    <Calendar className="mb-4 text-orange-500" size={24} />
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">مصروفات اليوم</p>
                    <h3 className={`text-3xl font-black ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {isSummaryLoading ? '...' : summary.today_amount.toLocaleString()} <span className="text-sm font-bold opacity-50">ج.م</span>
                    </h3>
                </div>

                <div className={`p-6 rounded-[2rem] border relative overflow-hidden group ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-blue-500/10"></div>
                    <FileText className="mb-4 text-blue-500" size={24} />
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">عدد العمليات المسجلة</p>
                    <h3 className={`text-3xl font-black ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {isSummaryLoading ? '...' : summary.count} <span className="text-sm font-bold opacity-50">سجل</span>
                    </h3>
                </div>
            </div>

            <div className={`p-6 rounded-[2rem] border mb-8 ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>من تاريخ</label>
                        <div className="relative group">
                            <input
                                type="date"
                                value={dateRange.start}
                                onChange={(e) => setDateRange((current) => ({ ...current, start: e.target.value }))}
                                style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                                className={`w-full h-11 pl-4 pr-10 rounded-xl border outline-none font-bold text-sm transition-all focus:ring-1 focus:ring-[#E53935]/50 ${isDarkMode ? 'bg-black/20 border-white/10 text-white focus:border-[#E53935] placeholder-gray-600' : 'bg-gray-50 border-gray-100 text-gray-900 focus:border-[#E53935]'}`}
                            />
                            <Calendar size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#E53935] transition-transform group-hover:scale-110" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>إلى تاريخ</label>
                        <div className="relative group">
                            <input
                                type="date"
                                value={dateRange.end}
                                onChange={(e) => setDateRange((current) => ({ ...current, end: e.target.value }))}
                                style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                                className={`w-full h-11 pl-4 pr-10 rounded-xl border outline-none font-bold text-sm transition-all focus:ring-1 focus:ring-[#E53935]/50 ${isDarkMode ? 'bg-black/20 border-white/10 text-white focus:border-[#E53935] placeholder-gray-600' : 'bg-gray-50 border-gray-100 text-gray-900 focus:border-[#E53935]'}`}
                            />
                            <Calendar size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#E53935] transition-transform group-hover:scale-110" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>نوع المصروف</label>
                        <div className="relative">
                            <select
                                value={selectedCategoryId}
                                onChange={(e) => setSelectedCategoryId(e.target.value)}
                                disabled={isCategoriesLoading}
                                className={`w-full h-11 pl-4 pr-10 rounded-xl border outline-none font-bold text-sm appearance-none cursor-pointer transition-all focus:ring-1 focus:ring-[#E53935]/50 disabled:cursor-not-allowed disabled:opacity-60 ${isDarkMode ? 'bg-black/20 border-white/10 text-white focus:border-[#E53935]' : 'bg-gray-50 border-gray-100 text-gray-900 focus:border-[#E53935]'}`}
                            >
                                <option value={ALL_CATEGORIES_VALUE}>عرض كافة الأنواع</option>
                                {activeCategories.map((category) => (
                                    <option key={category.id} value={String(category.id)}>
                                        {category.name}
                                    </option>
                                ))}
                            </select>
                            <div className={`absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                <ChevronDown size={16} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className={`rounded-[2rem] border overflow-hidden ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
                <div className={`px-6 py-4 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${isDarkMode ? 'border-white/5 bg-white/[0.015]' : 'border-black/5 bg-gray-50/70'}`}>
                    <div className="flex flex-col gap-1">
                        <span className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
                            عرض {expenses.length} من {pagination.total} سجل
                        </span>
                        <span className={`text-[11px] font-bold ${isDarkMode ? 'text-white/30' : 'text-gray-400'}`}>
                            صفحة {pagination.page} من {Math.max(1, pagination.total_pages || 1)}
                        </span>
                    </div>

                    {isPageLoading && (
                        <div className={`inline-flex items-center gap-2 text-xs font-bold ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
                            <RefreshCw size={14} className="animate-spin text-[#E53935]" />
                            جاري تحديث الصفحة...
                        </div>
                    )}
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-right">
                        <thead>
                            <tr className={`border-b text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'border-white/5 text-gray-400' : 'border-gray-100 text-gray-500'}`}>
                                <th className="px-6 py-5">التاريخ</th>
                                <th className="px-6 py-5">الفرع</th>
                                <th className="px-6 py-5">نوع المصروف</th>
                                <th className="px-6 py-5">المبلغ</th>
                                <th className="px-6 py-5">بواسطة</th>
                                <th className="px-6 py-5 w-1/3">ملاحظات</th>
                            </tr>
                        </thead>
                        <tbody className={`divide-y ${isDarkMode ? 'divide-white/5' : 'divide-gray-50'}`}>
                            {expenses.length > 0 ? (
                                expenses.map((expense) => (
                                    <tr key={expense.id} className={`group transition-colors ${isDarkMode ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50/50'}`}>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2" title={expense.date}>
                                                <Calendar size={14} className="opacity-40" />
                                                <span className={`text-sm font-bold font-mono ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{expense.date}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Building2 size={14} className="opacity-40" />
                                                <span className={`text-sm font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{expense.branch}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${isDarkMode ? 'bg-white/5 text-white' : 'bg-gray-100 text-gray-900'}`}>
                                                {expense.type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-sm font-bold text-[#E53935]">{expense.amount.toLocaleString()} ج.م</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <User size={14} className="opacity-40" />
                                                <span className="text-xs font-bold opacity-60">{expense.createdBy}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                {expense.notes && <StickyNote size={14} className="opacity-40 shrink-0" />}
                                                <span className={`text-xs font-bold ${expense.notes ? 'opacity-80' : 'opacity-30 italic'}`}>
                                                    {expense.notes || 'لا توجد ملاحظات'}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={6} className="py-24 text-center">
                                        <div className={`inline-flex items-center justify-center p-6 rounded-full mb-4 ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
                                            <AlertCircle size={32} className="opacity-20" />
                                        </div>
                                        <p className="text-sm font-bold opacity-40">
                                            {listError ? 'تعذر تحميل البيانات' : 'لا توجد مصروفات ضمن النطاق المحدد'}
                                        </p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {listError && hasLoadedListOnce && (
                    <div className={`px-6 py-4 border-t text-sm font-bold flex items-center justify-between gap-4 ${isDarkMode ? 'border-white/5 bg-red-500/5 text-red-300' : 'border-black/5 bg-red-50 text-red-600'}`}>
                        <div className="flex items-center gap-3">
                            <AlertCircle size={16} />
                            <span>{listError}</span>
                        </div>
                        <button onClick={() => fetchExpensesPage(currentPage)} className="text-xs uppercase tracking-widest opacity-80 hover:opacity-100">
                            إعادة المحاولة
                        </button>
                    </div>
                )}

                {pagination.total_pages > 1 && (
                    <div className={`px-6 py-4 border-t flex items-center justify-between gap-4 ${isDarkMode ? 'border-white/5 bg-white/[0.015]' : 'border-black/5 bg-gray-50/70'}`}>
                        <button
                            type="button"
                            disabled={currentPage <= 1 || isPageLoading}
                            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                            className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-xs font-bold text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            السابق
                        </button>
                        <span className={`text-xs font-bold ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                            صفحة {pagination.page} من {Math.max(1, pagination.total_pages)}
                        </span>
                        <button
                            type="button"
                            disabled={!pagination.has_more || isPageLoading}
                            onClick={() => setCurrentPage((page) => page + 1)}
                            className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-xs font-bold text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            التالي
                        </button>
                    </div>
                )}
            </div>

            {categoryModalOpen && (
                <div className="admin-overlay-shell z-[100] bg-black/60 backdrop-blur-sm animate-fade-in" dir="rtl">
                    <div className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden animate-scale-in ${isDarkMode ? 'bg-[#161616] border-white/10' : 'bg-white border-black/10'}`}>
                        <div className="p-6 border-b border-white/5 flex items-center justify-between">
                            <h3 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>إضافة نوع مصروف جديد</h3>
                            <button onClick={() => setCategoryModalOpen(false)} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-black/5 text-gray-500'}`}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold leading-relaxed flex gap-3">
                                <AlertCircle size={16} className="shrink-0" />
                                <p>أنواع المصروفات التي يتم إضافتها هنا ستظهر فوراً في نظام الكاشير بالفروع لتسجيل المصروفات عليها.</p>
                            </div>

                            <div className="space-y-2">
                                <label className={`text-xs font-bold uppercase tracking-wide ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    اسم النوع <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={newCategory.name}
                                    onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                                    placeholder="مثال: صيانة، ضيافة، أدوات..."
                                    className={`w-full p-4 rounded-xl border outline-none font-bold transition-all ${isDarkMode ? 'bg-black/20 border-white/10 text-white focus:border-[#E53935]/50' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/50'}`}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className={`text-xs font-bold uppercase tracking-wide ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    ملاحظات (اختياري)
                                </label>
                                <textarea
                                    value={newCategory.description}
                                    onChange={(e) => setNewCategory({ ...newCategory, description: e.target.value })}
                                    placeholder="وصف إضافي..."
                                    rows={3}
                                    className={`w-full p-4 rounded-xl border outline-none font-bold transition-all resize-none ${isDarkMode ? 'bg-black/20 border-white/10 text-white focus:border-[#E53935]/50' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/50'}`}
                                />
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-xl border border-dashed border-white/10 opacity-80 hover:opacity-100 transition-opacity">
                                <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>تفعيل النوع فوراً</span>
                                <button
                                    onClick={() => setNewCategory({ ...newCategory, isActive: !newCategory.isActive })}
                                    className={`w-12 h-6 rounded-full relative transition-colors ${newCategory.isActive ? 'bg-green-500' : 'bg-gray-600'}`}
                                >
                                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-md ${newCategory.isActive ? 'left-1' : 'left-7'}`}></span>
                                </button>
                            </div>
                        </div>

                        <div className={`p-6 border-t ${isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-black/5 bg-gray-50'}`}>
                            <h4 className={`text-xs font-bold uppercase tracking-widest mb-4 opacity-50 ${isDarkMode ? 'text-white' : 'text-black'}`}>
                                الأنواع المسجلة (المفعلة)
                            </h4>
                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                                {activeCategories.map((category) => (
                                    <div
                                        key={category.id}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 border group ${isDarkMode ? 'bg-black/20 border-white/10 text-white' : 'bg-white border-gray-200 text-gray-700'}`}
                                    >
                                        <span>{category.name}</span>
                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void handleDeleteCategory(category);
                                            }}
                                            className="w-5 h-5 flex items-center justify-center rounded bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                                {activeCategories.length === 0 && (
                                    <p className="text-xs opacity-40 italic">لا توجد أنواع مسجلة.</p>
                                )}
                            </div>
                        </div>

                        <div className={`p-6 border-t flex gap-4 ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
                            <button
                                onClick={() => setCategoryModalOpen(false)}
                                className={`flex-1 py-3.5 rounded-xl font-bold text-sm transition-colors ${isDarkMode ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-white border hover:bg-gray-50 text-gray-900'}`}
                            >
                                إلغاء
                            </button>
                            <button
                                onClick={handleAddCategory}
                                disabled={!newCategory.name.trim()}
                                className="flex-1 bg-[#E53935] hover:bg-[#FF3B30] disabled:opacity-50 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-bold text-sm shadow-lg shadow-red-900/20 transition-all flex items-center justify-center gap-2"
                            >
                                <Save size={16} />
                                حفظ النوع للنظام
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExpensesPage;
