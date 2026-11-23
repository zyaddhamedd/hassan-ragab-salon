import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  RefreshCw,
  Search,
  ServerCrash,
  Users,
  XCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import adminApi from '../api/client';
import {
  AdminAttendanceBusinessDaySelectorItem,
  AdminAttendanceLegacyResponse,
  AdminAttendanceLegacyRow,
  AdminAttendanceStatusValue,
  AdminAttendanceWorkspaceResponse,
  AdminAttendanceWorkspaceRow,
  AttendanceCheckoutSourceValue,
  EmployeeRole,
  ROLE_LABELS,
} from '../types';
import { formatDate, formatDateTime, formatTime, getTodayISO } from '../utils/dateFormatter';

interface AdminAttendanceDashboardProps {
  isDarkMode: boolean;
  selectedBranch?: string;
}

type AttendanceViewMode = 'business-day' | 'legacy';
type AttendanceStatusFilter = 'ALL' | AdminAttendanceStatusValue;
type AdminAttendanceDisplayRow = AdminAttendanceWorkspaceRow | AdminAttendanceLegacyRow;

const STATUS_FILTER_OPTIONS: Array<{ value: AttendanceStatusFilter; label: string }> = [
  { value: 'ALL', label: 'الكل' },
  { value: 'PRESENT', label: 'حاضر الآن' },
  { value: 'LEFT', label: 'انصرف' },
  { value: 'ABSENT', label: 'غائب' },
];

const STATUS_LABELS: Record<AdminAttendanceStatusValue, string> = {
  PRESENT: 'حاضر الآن',
  LEFT: 'انصرف',
  ABSENT: 'غائب',
};

const CHECKOUT_SOURCE_LABELS: Record<AttendanceCheckoutSourceValue, string> = {
  MANUAL: 'انصراف يدوي',
  BUSINESS_DAY_CLOSE: 'إقفال الخزنة',
  ADMIN_CORRECTION: 'تصحيح إداري',
};

const BUSINESS_DAY_STATUS_LABELS: Record<'OPEN' | 'CLOSED', string> = {
  OPEN: 'مفتوح',
  CLOSED: 'مغلق',
};

const SUMMARY_CARD_CONFIG = [
  { key: 'total_eligible', label: 'إجمالي العاملين', icon: Users, color: 'text-gray-500' },
  { key: 'attended', label: 'حضر', icon: CheckCircle2, color: 'text-green-500' },
  { key: 'absent', label: 'غائب', icon: XCircle, color: 'text-red-500' },
  { key: 'still_present', label: 'حاضر الآن', icon: Clock3, color: 'text-blue-500' },
  { key: 'auto_checked_out', label: 'انصراف تلقائي', icon: RefreshCw, color: 'text-amber-500' },
] as const;

function getErrorMessage(error: any, fallback: string): string {
  return error?.response?.data?.error || error?.message || fallback;
}

function sanitizeFilenameSegment(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'unknown';
}

function formatDuration(durationMinutes: number): string {
  if (durationMinutes <= 0) {
    return '0 د';
  }

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (hours === 0) {
    return `${minutes} د`;
  }
  if (minutes === 0) {
    return `${hours} س`;
  }

  return `${hours} س ${minutes} د`;
}

function getDefaultBusinessDay(
  businessDays: AdminAttendanceBusinessDaySelectorItem[],
): AdminAttendanceBusinessDaySelectorItem | null {
  const sortByOpenedAtDesc = (left: AdminAttendanceBusinessDaySelectorItem, right: AdminAttendanceBusinessDaySelectorItem) => {
    const leftValue = left.opened_at ? new Date(left.opened_at).getTime() : 0;
    const rightValue = right.opened_at ? new Date(right.opened_at).getTime() : 0;
    return rightValue - leftValue;
  };

  const latestOpen = businessDays
    .filter((businessDay) => businessDay.status === 'OPEN')
    .sort(sortByOpenedAtDesc)[0];
  if (latestOpen) {
    return latestOpen;
  }

  return businessDays
    .filter((businessDay) => businessDay.status === 'CLOSED')
    .sort(sortByOpenedAtDesc)[0] || null;
}

function buildBusinessDayOptionLabel(businessDay: AdminAttendanceBusinessDaySelectorItem): string {
  const segments = [
    `#${businessDay.id}`,
    businessDay.day_label || businessDay.business_date || 'بدون تاريخ',
    BUSINESS_DAY_STATUS_LABELS[businessDay.status],
  ];

  if (businessDay.opened_at) {
    segments.push(`فتح ${formatDateTime(businessDay.opened_at)}`);
  }

  if (businessDay.closed_at) {
    segments.push(`إقفال ${formatDateTime(businessDay.closed_at)}`);
  }

  return segments.join(' • ');
}

function isLegacyRow(row: AdminAttendanceDisplayRow): row is AdminAttendanceLegacyRow {
  return 'attendance_date' in row;
}

function getRowStatus(row: AdminAttendanceDisplayRow): AdminAttendanceStatusValue {
  return row.attendance_status;
}

function getRowCheckoutLabel(row: AdminAttendanceDisplayRow): string {
  return row.checkout_source ? CHECKOUT_SOURCE_LABELS[row.checkout_source] : '—';
}

function getRowEmployeeTypeLabel(row: AdminAttendanceDisplayRow): string {
  return ROLE_LABELS[row.employee_type as EmployeeRole] || row.employee_type;
}

function getRowBusinessDayText(row: AdminAttendanceDisplayRow): string {
  if (isLegacyRow(row)) {
    return row.attendance_date ? `سجل قديم • ${row.attendance_date}` : 'سجل قديم';
  }

  return `#${row.business_day_id} • ${row.business_day_label || row.business_date || '—'}`;
}

function getRowBusinessDateValue(row: AdminAttendanceDisplayRow): string {
  if (isLegacyRow(row)) {
    return row.attendance_date || '—';
  }

  return row.business_date || '—';
}

function getDisplayRows(
  mode: AttendanceViewMode,
  workspaceData: AdminAttendanceWorkspaceResponse | null,
  legacyData: AdminAttendanceLegacyResponse | null,
): AdminAttendanceDisplayRow[] {
  if (mode === 'business-day') {
    return workspaceData?.rows || [];
  }

  return legacyData?.rows || [];
}

const AdminAttendanceDashboard: React.FC<AdminAttendanceDashboardProps> = ({
  isDarkMode,
  selectedBranch: propSelectedBranch = 'All',
}) => {
  const isAllBranches = propSelectedBranch === 'All';
  const [allBranchesLegacyUnlocked, setAllBranchesLegacyUnlocked] = useState(false);

  const [mode, setMode] = useState<AttendanceViewMode>('business-day');
  const [dateFilter, setDateFilter] = useState<string>(getTodayISO());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AttendanceStatusFilter>('ALL');

  const [businessDays, setBusinessDays] = useState<AdminAttendanceBusinessDaySelectorItem[]>([]);
  const [businessDaysScopeKey, setBusinessDaysScopeKey] = useState<string | null>(null);
  const [selectedBusinessDayId, setSelectedBusinessDayId] = useState<number | null>(null);
  const [workspaceData, setWorkspaceData] = useState<AdminAttendanceWorkspaceResponse | null>(null);
  const [workspaceScopeKey, setWorkspaceScopeKey] = useState<string | null>(null);
  const [legacyData, setLegacyData] = useState<AdminAttendanceLegacyResponse | null>(null);
  const [legacyScopeKey, setLegacyScopeKey] = useState<string | null>(null);

  const [isBusinessDaysLoading, setIsBusinessDaysLoading] = useState(false);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isLegacyLoading, setIsLegacyLoading] = useState(false);

  const [businessDaysError, setBusinessDaysError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [legacyError, setLegacyError] = useState<string | null>(null);

  const [businessDaysReloadToken, setBusinessDaysReloadToken] = useState(0);
  const [workspaceReloadToken, setWorkspaceReloadToken] = useState(0);
  const [legacyReloadToken, setLegacyReloadToken] = useState(0);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const latestBranchRef = useRef(propSelectedBranch);
  const latestModeRef = useRef(mode);
  const latestSelectedBusinessDayIdRef = useRef<number | null>(selectedBusinessDayId);
  const latestDateFilterRef = useRef(dateFilter);

  useEffect(() => {
    latestBranchRef.current = propSelectedBranch;
  }, [propSelectedBranch]);

  useEffect(() => {
    latestModeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    latestSelectedBusinessDayIdRef.current = selectedBusinessDayId;
  }, [selectedBusinessDayId]);

  useEffect(() => {
    latestDateFilterRef.current = dateFilter;
  }, [dateFilter]);

  useEffect(() => {
    setMode('business-day');
    setAllBranchesLegacyUnlocked(false);
    setBusinessDays([]);
    setBusinessDaysScopeKey(null);
    setSelectedBusinessDayId(null);
    setWorkspaceData(null);
    setWorkspaceScopeKey(null);
    setLegacyData(null);
    setLegacyScopeKey(null);
    setBusinessDaysError(null);
    setWorkspaceError(null);
    setLegacyError(null);
  }, [isAllBranches, propSelectedBranch]);

  useEffect(() => {
    if (mode !== 'business-day' || isAllBranches) {
      setIsBusinessDaysLoading(false);
      return;
    }

    let isCancelled = false;
    const requestBranch = propSelectedBranch;

    setIsBusinessDaysLoading(true);
    setBusinessDaysError(null);
    setBusinessDays([]);
    setBusinessDaysScopeKey(null);
    setSelectedBusinessDayId(null);
    setWorkspaceData(null);
    setWorkspaceScopeKey(null);
    setWorkspaceError(null);

    adminApi
      .get<AdminAttendanceBusinessDaySelectorItem[]>('/business-days', {
        params: { branch_id: requestBranch },
      })
      .then((response) => {
        if (isCancelled) {
          return;
        }
        if (latestBranchRef.current !== requestBranch || latestModeRef.current !== 'business-day') {
          return;
        }

        const days = response.data || [];
        setBusinessDays(days);
        setBusinessDaysScopeKey(requestBranch);
        setSelectedBusinessDayId(getDefaultBusinessDay(days)?.id || null);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        if (latestBranchRef.current !== requestBranch || latestModeRef.current !== 'business-day') {
          return;
        }

        setBusinessDaysError(getErrorMessage(error, 'تعذر تحميل أيام العمل لهذا الفرع'));
      })
      .finally(() => {
        if (isCancelled) {
          return;
        }
        if (latestBranchRef.current !== requestBranch || latestModeRef.current !== 'business-day') {
          return;
        }

        setIsBusinessDaysLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [businessDaysReloadToken, isAllBranches, mode, propSelectedBranch]);

  const scopedBusinessDays = useMemo(() => {
    if (businessDaysScopeKey !== propSelectedBranch) {
      return [] as AdminAttendanceBusinessDaySelectorItem[];
    }

    return businessDays;
  }, [businessDays, businessDaysScopeKey, propSelectedBranch]);

  const selectedBusinessDay = useMemo(
    () => scopedBusinessDays.find((businessDay) => businessDay.id === selectedBusinessDayId) || null,
    [scopedBusinessDays, selectedBusinessDayId],
  );

  useEffect(() => {
    if (mode !== 'business-day' || isAllBranches || !selectedBusinessDayId || !selectedBusinessDay) {
      setIsWorkspaceLoading(false);
      return;
    }

    let isCancelled = false;
    const requestBranch = propSelectedBranch;
    const requestBusinessDayId = selectedBusinessDayId;

    setIsWorkspaceLoading(true);
    setWorkspaceError(null);
    setWorkspaceData(null);
    setWorkspaceScopeKey(null);

    adminApi
      .get<AdminAttendanceWorkspaceResponse>('/attendance/workspace', {
        params: { business_day_id: requestBusinessDayId },
      })
      .then((response) => {
        if (isCancelled) {
          return;
        }
        if (
          latestBranchRef.current !== requestBranch ||
          latestModeRef.current !== 'business-day' ||
          latestSelectedBusinessDayIdRef.current !== requestBusinessDayId
        ) {
          return;
        }

        setWorkspaceData(response.data);
        setWorkspaceScopeKey(`${requestBranch}:${requestBusinessDayId}`);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        if (
          latestBranchRef.current !== requestBranch ||
          latestModeRef.current !== 'business-day' ||
          latestSelectedBusinessDayIdRef.current !== requestBusinessDayId
        ) {
          return;
        }

        setWorkspaceError(getErrorMessage(error, 'تعذر تحميل مساحة عمل الحضور ليوم العمل المحدد'));
      })
      .finally(() => {
        if (isCancelled) {
          return;
        }
        if (
          latestBranchRef.current !== requestBranch ||
          latestModeRef.current !== 'business-day' ||
          latestSelectedBusinessDayIdRef.current !== requestBusinessDayId
        ) {
          return;
        }

        setIsWorkspaceLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [isAllBranches, mode, propSelectedBranch, selectedBusinessDay, selectedBusinessDayId, workspaceReloadToken]);

  useEffect(() => {
    if (mode !== 'legacy' || (isAllBranches && !allBranchesLegacyUnlocked)) {
      setIsLegacyLoading(false);
      return;
    }

    let isCancelled = false;
    const requestBranch = propSelectedBranch;
    const requestDate = dateFilter;
    const params: { date: string; branch_id?: string } = { date: requestDate };

    if (!isAllBranches) {
      params.branch_id = requestBranch;
    }

    setIsLegacyLoading(true);
    setLegacyError(null);
    setLegacyData(null);
    setLegacyScopeKey(null);

    adminApi
      .get<AdminAttendanceLegacyResponse>('/attendance/legacy', { params })
      .then((response) => {
        if (isCancelled) {
          return;
        }
        if (
          latestBranchRef.current !== requestBranch ||
          latestModeRef.current !== 'legacy' ||
          latestDateFilterRef.current !== requestDate
        ) {
          return;
        }

        setLegacyData(response.data);
        setLegacyScopeKey(`${requestBranch}:${requestDate}`);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        if (
          latestBranchRef.current !== requestBranch ||
          latestModeRef.current !== 'legacy' ||
          latestDateFilterRef.current !== requestDate
        ) {
          return;
        }

        setLegacyError(getErrorMessage(error, 'تعذر تحميل السجلات القديمة'));
      })
      .finally(() => {
        if (isCancelled) {
          return;
        }
        if (
          latestBranchRef.current !== requestBranch ||
          latestModeRef.current !== 'legacy' ||
          latestDateFilterRef.current !== requestDate
        ) {
          return;
        }

        setIsLegacyLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [allBranchesLegacyUnlocked, dateFilter, isAllBranches, legacyReloadToken, mode, propSelectedBranch]);

  const activeWorkspaceData = useMemo(() => {
    const expectedScopeKey = `${propSelectedBranch}:${selectedBusinessDayId ?? ''}`;
    if (workspaceScopeKey !== expectedScopeKey) {
      return null;
    }

    return workspaceData;
  }, [propSelectedBranch, selectedBusinessDayId, workspaceData, workspaceScopeKey]);

  const activeLegacyData = useMemo(() => {
    const expectedScopeKey = `${propSelectedBranch}:${dateFilter}`;
    if (legacyScopeKey !== expectedScopeKey) {
      return null;
    }

    return legacyData;
  }, [dateFilter, legacyData, legacyScopeKey, propSelectedBranch]);

  const activeRows = useMemo(
    () => getDisplayRows(mode, activeWorkspaceData, activeLegacyData),
    [activeLegacyData, activeWorkspaceData, mode],
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

    return activeRows.filter((row) => {
      const matchesStatus = statusFilter === 'ALL' || getRowStatus(row) === statusFilter;
      if (!matchesStatus) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [
        row.employee_name,
        getRowEmployeeTypeLabel(row),
        row.branch_name,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [activeRows, deferredSearchQuery, statusFilter]);

  const activeWorkspaceSummary = activeWorkspaceData?.summary || null;
  const showAllBranchesPrompt = isAllBranches && !allBranchesLegacyUnlocked;

  const isLoading = mode === 'business-day'
    ? isBusinessDaysLoading || (selectedBusinessDayId !== null && isWorkspaceLoading)
    : isLegacyLoading;

  const activeError = mode === 'business-day'
    ? businessDaysError || workspaceError
    : legacyError;

  const noBusinessDays = !showAllBranchesPrompt
    && mode === 'business-day'
    && !isBusinessDaysLoading
    && !businessDaysError
    && scopedBusinessDays.length === 0;

  const selectedBusinessDayMeta = activeWorkspaceData?.business_day || selectedBusinessDay;

  const handleModeChange = (nextMode: AttendanceViewMode) => {
    if (nextMode === mode || (nextMode === 'business-day' && isAllBranches)) {
      return;
    }

    if (nextMode === 'legacy') {
      setAllBranchesLegacyUnlocked(true);
    }
    setMode(nextMode);
    setWorkspaceData(null);
    setWorkspaceScopeKey(null);
    setWorkspaceError(null);
    setLegacyData(null);
    setLegacyScopeKey(null);
    setLegacyError(null);
  };

  const handleRetry = () => {
    if (mode === 'business-day') {
      if (businessDaysError || scopedBusinessDays.length === 0) {
        setBusinessDaysReloadToken((value) => value + 1);
        return;
      }

      setWorkspaceReloadToken((value) => value + 1);
      return;
    }

    setLegacyReloadToken((value) => value + 1);
  };

  const handleRefresh = () => {
    if (mode === 'business-day') {
      setBusinessDaysReloadToken((value) => value + 1);
      setWorkspaceReloadToken((value) => value + 1);
      return;
    }

    setLegacyReloadToken((value) => value + 1);
  };

  const handleExport = () => {
    if (filteredRows.length === 0) {
      return;
    }

    const exportData = filteredRows.map((row) => ({
      'رقم الحضور': row.attendance_id ?? '—',
      'الموظف': row.employee_name,
      'الوظيفة': getRowEmployeeTypeLabel(row),
      'الفرع': row.branch_name,
      'رقم يوم العمل': row.business_day_id ?? '—',
      'بيان يوم العمل': getRowBusinessDayText(row),
      'التاريخ التشغيلي': getRowBusinessDateValue(row),
      'وقت الحضور': row.check_in_time ? formatDateTime(row.check_in_time) : '—',
      'طبيعة تسجيل الحضور': row.is_manual_check_in
        ? `يدوي (الساعة: ${row.created_at ? formatDateTime(row.created_at) : '—'}${row.recorded_by ? ` • بواسطة ${row.recorded_by}` : ''})`
        : 'مباشر (تلقائي)',
      'وقت الانصراف': row.check_out_time ? formatDateTime(row.check_out_time) : '—',
      'المدة (دقائق)': row.duration_minutes,
      'الحالة': STATUS_LABELS[getRowStatus(row)],
      'طريقة الانصراف': getRowCheckoutLabel(row),
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');

    const branchSegment = sanitizeFilenameSegment(
      mode === 'business-day'
        ? selectedBusinessDayMeta?.branch_name || propSelectedBranch
        : isAllBranches
          ? 'all-branches'
          : `branch-${propSelectedBranch}`,
    );
    const dateSegment = mode === 'business-day'
      ? selectedBusinessDayMeta?.business_date || 'no-date'
      : dateFilter;
    const fileName = mode === 'business-day'
      ? `admin_attendance_${branchSegment}_business-day-${selectedBusinessDayId || 'none'}_${dateSegment}.xlsx`
      : `admin_attendance_${branchSegment}_old-records_${dateSegment}.xlsx`;

    XLSX.writeFile(workbook, fileName);
  };

  const emptyStateMessage = useMemo(() => {
    if (mode === 'business-day') {
      if (activeRows.length > 0 && filteredRows.length === 0) {
        return 'لا توجد نتائج مطابقة لفلاتر البحث الحالية';
      }

      return 'لا يوجد موظفون مؤهلون أو سجلات حضور ليوم العمل المحدد';
    }

    if (activeRows.length > 0 && filteredRows.length === 0) {
      return 'لا توجد نتائج مطابقة لفلاتر البحث الحالية';
    }

    return 'لا توجد سجلات حضور قديمة لهذا التاريخ';
  }, [activeRows.length, filteredRows.length, mode]);

  return (
    <div className={`admin-page-shell min-h-[calc(100vh-var(--app-header-height))] ${isDarkMode ? 'bg-[#0B0B0B]' : 'bg-[#F7F7F7]'} space-y-8 sm:p-8`}>
      <div className="mx-auto max-w-7xl space-y-8">
        <div className={`p-6 rounded-[2.5rem] border ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-2">
                <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>منصة تدقيق الحضور</h2>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {mode === 'business-day'
                    ? 'عرض جلسات الحضور لكل يوم عمل بدون دمج بين الجلسات.'
                    : 'سجلات حضور سابقة غير مرتبطة بيوم عمل.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className={`inline-flex items-center gap-2 rounded-2xl border p-1 ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gray-50 border-gray-200'}`}>
                  <button
                    type="button"
                    onClick={() => handleModeChange('business-day')}
                    disabled={isAllBranches}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${mode === 'business-day'
                      ? 'bg-[#E53935] text-white'
                      : isDarkMode
                        ? 'text-gray-400 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40'
                        : 'text-gray-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40'}`}
                  >
                    يوم العمل
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('legacy')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${mode === 'legacy'
                      ? 'bg-[#E53935] text-white'
                      : isDarkMode
                        ? 'text-gray-400 hover:bg-white/5'
                        : 'text-gray-600 hover:bg-white'}`}
                  >
                    السجلات القديمة
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleRefresh}
                  className={`flex items-center justify-center gap-2 px-4 py-3 h-12 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${isDarkMode ? 'bg-white/5 border border-white/10 text-white hover:bg-white/10' : 'bg-gray-50 border border-gray-200 text-[#121212] hover:bg-gray-100 shadow-sm'}`}
                >
                  <RefreshCw size={14} className={isLoading ? 'animate-spin text-[#E53935]' : 'text-[#E53935]'} />
                  تحديث
                </button>

                <button
                  type="button"
                  onClick={handleExport}
                  disabled={filteredRows.length === 0}
                  className={`flex items-center justify-center gap-2 px-4 py-3 h-12 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${filteredRows.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
                    } ${isDarkMode ? 'bg-white/5 border border-white/10 text-white hover:bg-white/10' : 'bg-gray-50 border border-gray-200 text-[#121212] hover:bg-gray-100 shadow-sm'}`}
                >
                  <Download size={14} className="text-[#E53935]" />
                  تصدير XLSX
                </button>
              </div>
            </div>

            <div className={`flex flex-wrap items-center gap-3 text-[11px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl ${isDarkMode ? 'bg-black/20 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                {showAllBranchesPrompt
                  ? 'الوضع الحالي: اختر فرعًا'
                  : mode === 'business-day'
                    ? 'الوضع الحالي: يوم العمل'
                    : 'الوضع الحالي: السجلات القديمة'}
              </span>
              <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl ${isDarkMode ? 'bg-black/20 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                {isAllBranches ? 'النطاق: كافة الفروع' : `الفرع المحدد: #${propSelectedBranch}`}
              </span>
              {mode === 'business-day' && selectedBusinessDayMeta && (
                <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl ${isDarkMode ? 'bg-black/20 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                  {`اليوم المحدد: #${selectedBusinessDayMeta.id} • ${selectedBusinessDayMeta.day_label || selectedBusinessDayMeta.business_date || '—'}`}
                </span>
              )}
              {mode === 'legacy' && (
                <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl ${isDarkMode ? 'bg-black/20 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                  {`تاريخ السجلات القديمة: ${dateFilter}`}
                </span>
              )}
            </div>

            {!showAllBranchesPrompt && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div className="xl:col-span-4 relative group">
                  <Search size={18} className={`absolute right-4 top-1/2 -translate-y-1/2 transition-colors ${isDarkMode ? 'text-gray-600 group-focus-within:text-[#E53935]' : 'text-gray-400 group-focus-within:text-[#E53935]'}`} />
                  <input
                    type="text"
                    placeholder="ابحث عن موظف..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className={`w-full h-12 pr-12 pl-4 rounded-2xl border text-xs font-bold outline-none transition-all ${isDarkMode ? 'bg-black/20 border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-100 text-gray-900 focus:border-[#E53935]/40'}`}
                  />
                </div>

                <div className="xl:col-span-3 relative">
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as AttendanceStatusFilter)}
                    className={`w-full h-12 px-4 rounded-2xl border text-xs font-bold outline-none transition-all appearance-none ${isDarkMode ? 'bg-black/20 border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-100 text-gray-900 focus:border-[#E53935]/40'}`}
                  >
                    {STATUS_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {mode === 'business-day' ? (
                  <div className="xl:col-span-5 relative">
                    <select
                      value={selectedBusinessDayId ?? ''}
                      onChange={(event) => setSelectedBusinessDayId(event.target.value ? Number(event.target.value) : null)}
                      disabled={isBusinessDaysLoading || scopedBusinessDays.length === 0}
                      className={`w-full h-12 px-4 rounded-2xl border text-xs font-bold outline-none transition-all appearance-none ${isDarkMode ? 'bg-black/20 border-white/5 text-white focus:border-[#E53935]/40 disabled:opacity-50' : 'bg-gray-50 border-gray-100 text-gray-900 focus:border-[#E53935]/40 disabled:opacity-50'}`}
                    >
                      <option value="" disabled>
                        {isBusinessDaysLoading
                          ? 'جاري تحميل أيام العمل...'
                          : scopedBusinessDays.length === 0
                            ? 'لا توجد أيام عمل لهذا الفرع'
                            : 'اختر يوم العمل'}
                      </option>
                      {scopedBusinessDays.map((businessDay) => (
                        <option key={businessDay.id} value={businessDay.id}>
                          {buildBusinessDayOptionLabel(businessDay)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="xl:col-span-5 relative group">
                    <Calendar size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#E53935]" />
                    <input
                      type="date"
                      value={dateFilter}
                      onChange={(event) => setDateFilter(event.target.value)}
                      style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                      className={`w-full h-12 pr-12 pl-4 rounded-2xl border text-xs font-bold outline-none transition-all ${isDarkMode ? 'bg-black/20 border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-100 text-gray-900 focus:border-[#E53935]/40'}`}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {mode === 'business-day' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            {SUMMARY_CARD_CONFIG.map((stat) => {
              const value = activeWorkspaceSummary?.[stat.key] ?? 0;
              return (
                <div key={stat.key} className={`p-6 rounded-[2rem] border transition-all ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className={`p-3 rounded-2xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
                      <stat.icon size={18} className={stat.color} />
                    </div>
                    <span className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {isLoading ? '...' : value}
                    </span>
                  </div>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{stat.label}</p>
                </div>
              );
            })}
          </div>
        )}

        {activeError && (
          <div className={`rounded-[2.5rem] border p-10 text-center ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
            <div className="space-y-4">
              <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto">
                <ServerCrash size={32} />
              </div>
              <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{activeError}</h3>
              <button
                type="button"
                onClick={handleRetry}
                className="px-6 py-2 bg-[#E53935] text-white rounded-xl font-bold text-xs flex items-center gap-2 mx-auto"
              >
                <RefreshCw size={14} />
                إعادة المحاولة
              </button>
            </div>
          </div>
        )}

        {!activeError && showAllBranchesPrompt && (
          <div className={`rounded-[2.5rem] border p-12 text-center ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
            <FileText size={48} className={`mx-auto mb-4 ${isDarkMode ? 'text-gray-600' : 'text-gray-300'}`} />
            <h3 className={`text-xl font-bold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>اختر فرعًا لعرض الحضور</h3>
            <p className={`max-w-2xl mx-auto text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              أيام العمل والحضور مرتبطة بكل فرع بشكل مستقل. اختر فرعًا من القائمة بالأعلى لعرض أيام العمل والسجلات.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => handleModeChange('legacy')}
                className={`px-6 py-3 rounded-2xl font-bold text-xs border ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-gray-200 text-gray-900 hover:bg-gray-50'}`}
              >
                عرض السجلات القديمة
              </button>
            </div>
          </div>
        )}

        {!activeError && !showAllBranchesPrompt && noBusinessDays && (
          <div className={`rounded-[2.5rem] border p-12 text-center ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
            <FileText size={48} className={`mx-auto mb-4 ${isDarkMode ? 'text-gray-600' : 'text-gray-300'}`} />
            <h3 className={`text-xl font-bold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>لا توجد أيام عمل لهذا الفرع</h3>
            <p className={`max-w-2xl mx-auto text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              لا يمكن عرض مساحة عمل يوم العمل قبل وجود Business Day لهذا الفرع. يمكنك الانتقال يدوياً إلى السجلات القديمة إذا كنت تريد مراجعة الصفوف القديمة غير المرتبطة بيوم عمل.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => handleModeChange('legacy')}
                className="px-6 py-3 bg-[#E53935] text-white rounded-2xl font-bold text-xs"
              >
                فتح السجلات القديمة
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                className={`px-6 py-3 rounded-2xl font-bold text-xs border ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-gray-200 text-gray-900 hover:bg-gray-50'}`}
              >
                إعادة التحميل
              </button>
            </div>
          </div>
        )}

        {!activeError && !showAllBranchesPrompt && !noBusinessDays && (
          <div className={`rounded-[2.5rem] border overflow-hidden ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
            <div className={`px-6 py-4 border-b flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${isDarkMode ? 'border-white/5 bg-black/20' : 'border-black/5 bg-gray-50'}`}>
              <div>
                <h3 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {mode === 'business-day' ? 'سجلات يوم العمل' : 'السجلات القديمة'}
                </h3>
                <p className={`text-[11px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {mode === 'business-day'
                    ? `يتم عرض كل جلسة حضور كسطر مستقل${selectedBusinessDayMeta ? ` • #${selectedBusinessDayMeta.id}` : ''}`
                    : 'يعرض فقط سجلات الحضور السابقة غير المرتبطة بيوم عمل.'}
                </p>
                {mode === 'legacy' && (
                  <p className={`mt-2 text-[11px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    سجلات أيام العمل الحالية والسابقة متاحة من وضع «يوم العمل» بعد اختيار الفرع.
                  </p>
                )}
              </div>
              <div className={`text-[11px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {`الصفوف المعروضة: ${filteredRows.length}`}
              </div>
            </div>

            <div
              className="attendance-table-scroll max-w-full overflow-x-auto overflow-y-hidden pb-2"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: isDarkMode
                  ? 'rgba(148, 163, 184, 0.35) transparent'
                  : 'rgba(100, 116, 139, 0.35) transparent',
              }}
            >
              <table className="w-full min-w-[1220px] text-right border-collapse">
                <thead>
                  <tr className={`${isDarkMode ? 'bg-black/20' : 'bg-gray-50'} border-b ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
                    <th className="p-5 min-w-[220px] text-[10px] font-bold uppercase tracking-widest opacity-40">الموظف</th>
                    <th className="p-5 min-w-[110px] text-[10px] font-bold uppercase tracking-widest opacity-40">الوظيفة</th>
                    <th className="p-5 min-w-[130px] text-[10px] font-bold uppercase tracking-widest opacity-40">الفرع</th>
                    <th className="p-5 min-w-[230px] text-[10px] font-bold uppercase tracking-widest opacity-40">يوم العمل</th>
                    <th className="p-5 min-w-[130px] text-[10px] font-bold uppercase tracking-widest opacity-40 text-center">وقت الحضور</th>
                    <th className="p-5 min-w-[130px] text-[10px] font-bold uppercase tracking-widest opacity-40 text-center">وقت الانصراف</th>
                    <th className="p-5 min-w-[110px] text-[10px] font-bold uppercase tracking-widest opacity-40 text-center">المدة</th>
                    <th className="p-5 min-w-[120px] text-[10px] font-bold uppercase tracking-widest opacity-40 text-center">الحالة</th>
                    <th className="p-5 min-w-[170px] text-[10px] font-bold uppercase tracking-widest opacity-40 text-center">طريقة الانصراف</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? 'divide-white/5' : 'divide-gray-50'}`}>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="p-5"><div className="h-10 bg-gray-500/10 rounded-2xl w-3/4"></div></td>
                        <td className="p-5"><div className="h-4 bg-gray-500/10 rounded w-1/2"></div></td>
                        <td className="p-5"><div className="h-4 bg-gray-500/10 rounded w-2/3"></div></td>
                        <td className="p-5"><div className="h-4 bg-gray-500/10 rounded w-4/5"></div></td>
                        <td className="p-5 text-center"><div className="h-8 bg-gray-500/10 rounded-xl w-24 mx-auto"></div></td>
                        <td className="p-5 text-center"><div className="h-8 bg-gray-500/10 rounded-xl w-24 mx-auto"></div></td>
                        <td className="p-5 text-center"><div className="h-8 bg-gray-500/10 rounded-xl w-16 mx-auto"></div></td>
                        <td className="p-5 text-center"><div className="h-8 bg-gray-500/10 rounded-xl w-20 mx-auto"></div></td>
                        <td className="p-5 text-center"><div className="h-8 bg-gray-500/10 rounded-xl w-24 mx-auto"></div></td>
                      </tr>
                    ))
                  ) : filteredRows.map((row, index) => {
                    const status = getRowStatus(row);
                    const statusBadgeClass = status === 'ABSENT'
                      ? 'bg-red-500/10 text-red-500'
                      : status === 'PRESENT'
                        ? 'bg-green-500/10 text-green-500'
                        : isDarkMode
                          ? 'bg-white/5 text-gray-300'
                          : 'bg-gray-50 text-gray-700';

                    return (
                      <tr key={`${row.employee_id}-${row.attendance_id ?? 'absence'}-${index}`} className={`group transition-colors ${isDarkMode ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50'}`}>
                        <td className="p-5 align-top">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-xs ${isDarkMode ? 'bg-white/5 text-[#E6D690]' : 'bg-gray-100 text-gray-700'}`}>
                              {row.employee_name.charAt(0)}
                            </div>
                            <div>
                              <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{row.employee_name}</p>
                              <p className="text-[10px] opacity-40">
                                {row.attendance_id ? `Attendance #${row.attendance_id}` : 'سجل غياب'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="p-5 text-sm font-medium opacity-60 whitespace-nowrap align-top">{getRowEmployeeTypeLabel(row)}</td>
                        <td className="p-5 text-sm font-medium opacity-60 whitespace-nowrap align-top">{row.branch_name}</td>
                        <td className="p-5 align-top">
                          <div className="space-y-1">
                            <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{getRowBusinessDayText(row)}</p>
                            <p className="text-[10px] opacity-40">{getRowBusinessDateValue(row)}</p>
                          </div>
                        </td>
                        <td className="p-5 text-center align-top">
                          {row.check_in_time ? (
                            <div className="space-y-1">
                              <div className="flex items-center justify-center gap-1.5">
                                <span className="font-mono text-xs font-bold">{formatTime(row.check_in_time)}</span>
                                {row.is_manual_check_in && (
                                  <span
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[#A8906A]/15 text-[#A8906A] border border-[#A8906A]/30 cursor-help"
                                    title={`تسجيل يدوي — الساعة ${row.created_at ? formatTime(row.created_at) : '—'}${row.recorded_by ? ` • بواسطة ${row.recorded_by}` : ''}`}
                                  >
                                    يدوي
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] opacity-40">{formatDate(row.check_in_time)}</p>
                              {row.is_manual_check_in && row.created_at && (
                                <p
                                  className="text-[9px] text-[#A8906A]/75 font-medium"
                                  title={`الساعة: ${formatTime(row.created_at)}${row.recorded_by ? ` بواسطة ${row.recorded_by}` : ''}`}
                                >
                                  الساعة {formatTime(row.created_at)}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="opacity-20">—</span>
                          )}
                        </td>
                        <td className="p-5 text-center align-top">
                          {row.check_out_time ? (
                            <div className="space-y-1">
                              <p className="font-mono text-xs font-bold">{formatTime(row.check_out_time)}</p>
                              <p className="text-[10px] opacity-40">{formatDate(row.check_out_time)}</p>
                            </div>
                          ) : (
                            <span className="opacity-20">—</span>
                          )}
                        </td>
                        <td className="p-5 text-center align-top">
                          <span className={`inline-flex items-center justify-center px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'bg-white/5 text-gray-300' : 'bg-gray-50 text-gray-700'}`}>
                            {status === 'ABSENT' ? '—' : formatDuration(row.duration_minutes)}
                          </span>
                        </td>
                        <td className="p-5 text-center align-top">
                          <span className={`inline-flex items-center justify-center px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest ${statusBadgeClass}`}>
                            {STATUS_LABELS[status]}
                          </span>
                        </td>
                        <td className="p-5 text-center align-top">
                          <span className={`inline-flex min-w-[138px] items-center justify-center px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'bg-white/5 text-gray-300' : 'bg-gray-50 text-gray-700'}`}>
                            {getRowCheckoutLabel(row)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!isLoading && filteredRows.length === 0 && (
              <div className={`py-32 text-center ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                <FileText size={48} className="mx-auto mb-4 opacity-10" />
                <p className="text-sm font-bold uppercase tracking-widest opacity-40">{emptyStateMessage}</p>
              </div>
            )}
          </div>
        )}

        <footer className="py-12 text-center opacity-20">
          <p className={`text-[9px] font-bold uppercase tracking-[0.5em] ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            Attendance Workspace Console • The Secret Men Club
          </p>
        </footer>
        <style>{`
          .attendance-table-scroll::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          .attendance-table-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .attendance-table-scroll::-webkit-scrollbar-thumb {
            background: rgba(148, 163, 184, 0.28);
            border-radius: 999px;
          }
          .attendance-table-scroll:hover::-webkit-scrollbar-thumb {
            background: rgba(148, 163, 184, 0.42);
          }
        `}</style>
      </div>
    </div>
  );
};

export default AdminAttendanceDashboard;
