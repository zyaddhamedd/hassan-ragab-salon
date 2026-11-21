import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ProductMovementBadge from './ProductMovementBadge';
import { movementPresentations } from './productMovementPresentation';
import { workspaceFocus, workspaceStyles } from './productWorkspaceStyles';

interface Props { isDarkMode: boolean; legacyLabels?: boolean }

export default function ProductMovementLegend({ isDarkMode, legacyLabels = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const tone = workspaceStyles(isDarkMode);
  return <div dir="rtl" className={`min-w-0 rounded-xl border px-3 ${tone.divider}`}>
    <button type="button" id={`${id}-toggle`} aria-expanded={expanded} aria-controls={`${id}-content`}
      onClick={() => setExpanded((value) => !value)}
      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-md py-2 text-start text-xs font-bold ${workspaceFocus}`}>
      دليل أنواع الحركات
      <ChevronDown size={14} aria-hidden="true" className={`shrink-0 ${expanded ? 'rotate-180' : ''}`} />
    </button>
    <div id={`${id}-content`} hidden={!expanded} role="region" aria-labelledby={`${id}-toggle`}>
      {expanded && <div className="space-y-2 pb-3">
        <p className={`text-xs leading-5 ${tone.muted}`}>الوصف يشرح نوع التسجيل في الموقع الموضح، ولا يثبت اتجاه كل حركة تاريخية. الزيادة أو النقص حسب التغيير (+/−) المتاح بالسجل.</p>
        <ul className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {Object.entries(movementPresentations).map(([type, presentation]) => <li key={type} className="min-w-0 space-y-1">
            <ProductMovementBadge type={type} isDarkMode={isDarkMode} legacyLabels={legacyLabels} />
            <p className={`break-words text-xs leading-5 ${tone.muted}`}>{presentation.description}</p>
          </li>)}
        </ul>
      </div>}
    </div>
  </div>;
}
