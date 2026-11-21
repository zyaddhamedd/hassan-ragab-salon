export type SupplyWorkspaceTab = 'overview' | 'catalog' | 'history' | 'requests' | 'returns';

export type SupplyWorkspaceBranchValue = 'all' | `${number}`;

export type SupplyWorkspaceDatePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_30_days'
  | 'custom';

export type SupplyWorkspaceStatusValue =
  | 'all'
  | 'in_transit'
  | 'received'
  | 'pending'
  | 'sent'
  | 'returned_to_main'
  | 'returned_to_supplier'
  | 'rejected'
  | 'attention';

export interface SupplyWorkspaceOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SupplyWorkspaceState {
  branch: SupplyWorkspaceBranchValue;
  datePreset: SupplyWorkspaceDatePreset;
  dateFrom: string;
  dateTo: string;
  status: SupplyWorkspaceStatusValue;
}

export const SUPPLY_WORKSPACE_DEFAULT_STATE: SupplyWorkspaceState = {
  branch: 'all',
  datePreset: 'last_30_days',
  dateFrom: '',
  dateTo: '',
  status: 'all',
};

export const SUPPLY_WORKSPACE_ALL_BRANCH_OPTION: SupplyWorkspaceOption<SupplyWorkspaceBranchValue> = {
  value: 'all',
  label: 'كل الفروع',
};

export const SUPPLY_WORKSPACE_DATE_PRESET_OPTIONS: Array<SupplyWorkspaceOption<SupplyWorkspaceDatePreset>> = [
  { value: 'today', label: 'اليوم' },
  { value: 'yesterday', label: 'أمس' },
  { value: 'this_week', label: 'هذا الأسبوع' },
  { value: 'this_month', label: 'هذا الشهر' },
  { value: 'last_30_days', label: 'آخر 30 يوم' },
  { value: 'custom', label: 'فترة مخصصة' },
];

const SUPPLY_WORKSPACE_STATUS_OPTIONS: Record<
  Exclude<SupplyWorkspaceTab, 'catalog'>,
  Array<SupplyWorkspaceOption<SupplyWorkspaceStatusValue>>
> = {
  overview: [
    { value: 'all', label: 'الكل' },
    { value: 'attention', label: 'تحتاج متابعة' },
    { value: 'in_transit', label: 'قيد النقل' },
    { value: 'pending', label: 'قيد المراجعة' },
    { value: 'received', label: 'تم الاستلام' },
  ],
  history: [
    { value: 'all', label: 'الكل' },
    { value: 'in_transit', label: 'قيد النقل' },
    { value: 'received', label: 'تم الاستلام' },
  ],
  requests: [
    { value: 'all', label: 'الكل' },
    { value: 'pending', label: 'قيد الانتظار' },
    { value: 'sent', label: 'تم الإرسال' },
    { value: 'received', label: 'تم الاستلام' },
  ],
  returns: [
    { value: 'all', label: 'الكل' },
    { value: 'pending', label: 'قيد الانتظار' },
    { value: 'returned_to_main', label: 'عودة للمخزن الرئيسي' },
    { value: 'returned_to_supplier', label: 'عودة للمورد' },
    { value: 'rejected', label: 'مرفوض' },
  ],
};

export const SUPPLY_WORKSPACE_SECTION_LABELS: Record<SupplyWorkspaceTab, string> = {
  overview: 'نظرة عامة',
  catalog: 'الكتالوج',
  history: 'سجل الشحنات',
  requests: 'طلبات الفروع',
  returns: 'المرتجعات',
};

export const getSupplyWorkspaceDatePresetLabel = (preset: SupplyWorkspaceDatePreset) =>
  SUPPLY_WORKSPACE_DATE_PRESET_OPTIONS.find((option) => option.value === preset)?.label || 'آخر 30 يوم';

export const getSupplyWorkspaceStatusOptions = (tab: SupplyWorkspaceTab) => {
  if (tab === 'catalog') {
    return SUPPLY_WORKSPACE_STATUS_OPTIONS.overview;
  }

  return SUPPLY_WORKSPACE_STATUS_OPTIONS[tab];
};
