interface MovementPresentation {
  label: string;
  legacyLabel?: string;
  description: string;
  light: string;
  dark: string;
}

const neutral = {
  light: 'border-slate-300 bg-slate-100 text-slate-700',
  dark: 'border-slate-600 bg-slate-800 text-slate-200',
};

// Presentation only: the recorded type never establishes a legacy delta's sign.
export const movementPresentations: Readonly<Record<string, MovementPresentation>> = {
  PRODUCT_SALE: {
    label: 'بيع', description: 'بيع المنتج ضمن فاتورة، ويكون الخصم من الموقع الموضح بالحركة.',
    light: 'border-violet-200 bg-violet-50 text-violet-800',
    dark: 'border-violet-800 bg-violet-950 text-violet-200',
  },
  INTERNAL_CONSUMPTION: {
    label: 'استهلاك داخلي', description: 'استخدام المنتج داخل الفرع، ويكون الخصم من رصيد الفرع الموضح.',
    light: 'border-teal-200 bg-teal-50 text-teal-800',
    dark: 'border-teal-800 bg-teal-950 text-teal-200',
  },
  SUPPLY_IN: {
    label: 'توريد', description: 'تسجيل توريد للموقع الموضح؛ بعض السجلات التاريخية تحمل تعديلات مخزون.',
    light: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    dark: 'border-emerald-800 bg-emerald-950 text-emerald-200',
  },
  TRANSFER_OUT: {
    label: 'تحويل صادر', description: 'إرسال كمية من الموقع الموضح لموقع آخر، وقد يشمل الرجوع للمخزن الرئيسي.',
    light: 'border-amber-200 bg-amber-50 text-amber-900',
    dark: 'border-amber-800 bg-amber-950 text-amber-200',
  },
  TRANSFER_IN: {
    label: 'تحويل وارد', description: 'استلام كمية في الموقع الموضح من شحنة أو تحويل، وقد يشمل مرتجعًا للمخزن الرئيسي.',
    light: 'border-blue-200 bg-blue-50 text-blue-800',
    dark: 'border-blue-800 bg-blue-950 text-blue-200',
  },
  RETURN_TO_SUPPLIER: {
    label: 'مرتجع للمورد', legacyLabel: 'إرجاع للمورد', description: 'إرجاع كمية للمورد، ويكون الخصم من الموقع الموضح بالحركة.',
    light: 'border-red-200 bg-red-50 text-red-800',
    dark: 'border-red-800 bg-red-950 text-red-200',
  },
  STOCK_ADJUSTMENT: {
    label: 'تعديل مخزني', legacyLabel: 'تعديل', description: 'تعديل مسجل لرصيد الموقع؛ نوع الحركة وحده لا يحدد الزيادة أو النقص.',
    ...neutral,
  },
};

export const movementLabels: Record<string, string> = Object.fromEntries(
  Object.entries(movementPresentations).map(([type, presentation]) => [type, presentation.label]),
);

export function movementPresentation(type: string): MovementPresentation {
  return Object.prototype.hasOwnProperty.call(movementPresentations, type)
    ? movementPresentations[type]
    : { label: type, description: 'نوع حركة غير معروف؛ راجع تفاصيل السجل.', ...neutral };
}
