import { Branch } from '../../types';
import {
  SUPPLY_WORKSPACE_ALL_BRANCH_OPTION,
  SUPPLY_WORKSPACE_DEFAULT_STATE,
  SupplyWorkspaceBranchValue,
  SupplyWorkspaceDatePreset,
  SupplyWorkspaceOption,
  SupplyWorkspaceState,
} from './supplyWorkspaceTypes.ts';

export type SupplyWorkspaceBranchOption = SupplyWorkspaceOption<SupplyWorkspaceBranchValue>;

const padDatePart = (value: number) => String(value).padStart(2, '0');

const toDateInputValue = (value: Date) =>
  `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`;

const startOfLocalDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

const shiftDays = (value: Date, delta: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + delta);
  return next;
};

const getStartOfWeek = (value: Date) => {
  const start = startOfLocalDay(value);
  const dayIndex = start.getDay();
  const daysSinceSaturday = (dayIndex + 1) % 7;
  start.setDate(start.getDate() - daysSinceSaturday);
  return start;
};

const isValidDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && toDateInputValue(parsed) === value;
};

export interface SupplyWorkspaceResolvedDateRange {
  dateFrom: string;
  dateTo: string;
}

export interface SupplyWorkspaceValidationResult {
  isValid: boolean;
  message: string | null;
}

export const buildSupplyWorkspaceBranchOptions = (branches: Branch[]): SupplyWorkspaceBranchOption[] => {
  const uniqueActiveBranches = Array.from(
    new Map(
      branches
        .filter((branch) => branch?.id && branch.is_active !== false)
        .map((branch) => [branch.id, { value: String(branch.id) as SupplyWorkspaceBranchValue, label: branch.name }]),
    ).values(),
  );

  return [SUPPLY_WORKSPACE_ALL_BRANCH_OPTION, ...uniqueActiveBranches];
};

export const getSupplyWorkspaceBranchLabel = (
  branchValue: SupplyWorkspaceBranchValue,
  branchOptions: SupplyWorkspaceBranchOption[],
) => branchOptions.find((option) => option.value === branchValue)?.label || SUPPLY_WORKSPACE_ALL_BRANCH_OPTION.label;

export const resolveSupplyWorkspaceDateRange = (
  state: SupplyWorkspaceState,
  now: Date = new Date(),
): SupplyWorkspaceResolvedDateRange => {
  const today = startOfLocalDay(now);

  if (state.datePreset === 'custom') {
    return {
      dateFrom: state.dateFrom,
      dateTo: state.dateTo,
    };
  }

  const presetRanges: Record<Exclude<SupplyWorkspaceDatePreset, 'custom'>, SupplyWorkspaceResolvedDateRange> = {
    today: {
      dateFrom: toDateInputValue(today),
      dateTo: toDateInputValue(today),
    },
    yesterday: {
      dateFrom: toDateInputValue(shiftDays(today, -1)),
      dateTo: toDateInputValue(shiftDays(today, -1)),
    },
    this_week: {
      dateFrom: toDateInputValue(getStartOfWeek(today)),
      dateTo: toDateInputValue(today),
    },
    this_month: {
      dateFrom: toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
      dateTo: toDateInputValue(today),
    },
    last_30_days: {
      dateFrom: toDateInputValue(shiftDays(today, -29)),
      dateTo: toDateInputValue(today),
    },
  };

  return presetRanges[state.datePreset];
};

export const validateSupplyWorkspaceFilters = (state: SupplyWorkspaceState): SupplyWorkspaceValidationResult => {
  if (state.datePreset !== 'custom') {
    return { isValid: true, message: null };
  }

  if (!state.dateFrom || !state.dateTo) {
    return { isValid: false, message: 'اختر تاريخ البداية والنهاية للفترة المخصصة.' };
  }

  if (!isValidDateInput(state.dateFrom) || !isValidDateInput(state.dateTo)) {
    return { isValid: false, message: 'صيغة التاريخ غير صحيحة.' };
  }

  if (state.dateFrom > state.dateTo) {
    return { isValid: false, message: 'تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية.' };
  }

  return { isValid: true, message: null };
};

export const countActiveSupplyWorkspaceFilters = (state: SupplyWorkspaceState) => {
  let count = 0;

  if (state.branch !== SUPPLY_WORKSPACE_DEFAULT_STATE.branch) count += 1;
  if (state.datePreset !== SUPPLY_WORKSPACE_DEFAULT_STATE.datePreset) count += 1;

  return count;
};

export const buildSupplyWorkspaceSummary = (
  state: SupplyWorkspaceState,
  branchOptions: SupplyWorkspaceBranchOption[],
) => {
  const branch = getSupplyWorkspaceBranchLabel(state.branch, branchOptions);
  const dateRange = resolveSupplyWorkspaceDateRange(state);
  const dateLabel =
    state.datePreset === 'custom' && dateRange.dateFrom && dateRange.dateTo
      ? `${dateRange.dateFrom} - ${dateRange.dateTo}`
      : ({
          today: 'اليوم',
          yesterday: 'أمس',
          this_week: 'هذا الأسبوع',
          this_month: 'هذا الشهر',
          last_30_days: 'آخر 30 يوم',
          custom: 'فترة مخصصة',
        }[state.datePreset]);

  return `${branch} • ${dateLabel}`;
};

export const buildSupplyWorkspaceQueryParams = (state: SupplyWorkspaceState, now: Date = new Date()) => {
  const params = new URLSearchParams();
  const { dateFrom, dateTo } = resolveSupplyWorkspaceDateRange(state, now);

  if (state.branch !== 'all') {
    params.set('branch_id', state.branch);
  }

  if (dateFrom) {
    params.set('date_from', dateFrom);
  }

  if (dateTo) {
    params.set('date_to', dateTo);
  }

  return params;
};

export const buildSupplyWorkspaceFilterSignature = (state: SupplyWorkspaceState, now: Date = new Date()) =>
  buildSupplyWorkspaceQueryParams(state, now).toString();

export const buildShipmentHistoryQueryParams = (state: SupplyWorkspaceState, now: Date = new Date()) =>
  buildSupplyWorkspaceQueryParams(state, now);

export const buildShipmentHistoryFilterSignature = (state: SupplyWorkspaceState, now: Date = new Date()) =>
  buildSupplyWorkspaceFilterSignature(state, now);
