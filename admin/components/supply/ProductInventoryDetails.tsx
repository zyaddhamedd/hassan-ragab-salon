import React, { useId, useRef, useState } from 'react';
import { ProductWorkspaceActivity, ProductWorkspaceBatch } from '../../types';
import ProductActivityTimeline from './ProductActivityTimeline';
import ProductBatchBreakdown from './ProductBatchBreakdown';
import ProductActivityHistory from './ProductActivityHistory';
import ProductBatchHistory from './ProductBatchHistory';
import { workspaceFocus, workspaceStyles } from './productWorkspaceStyles';

interface Props {
  productId?: number;
  onSelectBranch?: (id: number | null) => void;
  activities: ProductWorkspaceActivity[];
  batches: ProductWorkspaceBatch[];
  activeBranchId: number | null;
  unit: string;
  isDarkMode: boolean;
}
const tabs = [{ key: 'activity', label: 'حركة المنتج' }, { key: 'batches', label: 'دفعات المخزون' }] as const;

export default function ProductInventoryDetails({ productId, onSelectBranch, activities, batches, activeBranchId, unit, isDarkMode }: Props) {
  const [active, setActive] = useState<typeof tabs[number]['key']>('activity');
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const tone = workspaceStyles(isDarkMode);
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else if (event.key === 'ArrowLeft') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowRight') next = (index - 1 + tabs.length) % tabs.length;
    else return;
    event.preventDefault();
    setActive(tabs[next].key);
    buttons.current[next]?.focus();
  };
  return (
    <section className={`${tone.panel} min-w-0 overflow-hidden`}>
      <div role="tablist" aria-label="تفاصيل مخزون المنتج" className={`flex border-b px-2 ${tone.divider}`}>
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            ref={(node) => { buttons.current[index] = node; }}
            type="button"
            role="tab"
            id={`${id}-${tab.key}-tab`}
            aria-controls={`${id}-${tab.key}-panel`}
            aria-selected={active === tab.key}
            tabIndex={active === tab.key ? 0 : -1}
            onClick={() => setActive(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-11 border-b-2 px-3 py-3 text-xs font-bold sm:px-4 ${workspaceFocus} ${active === tab.key ? `border-[#E53935] ${isDarkMode ? 'text-red-300' : 'text-red-700'}` : `border-transparent ${tone.muted}`}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-activity-panel`} aria-labelledby={`${id}-activity-tab`} hidden={active !== 'activity'} tabIndex={0} className={`p-4 sm:p-5 ${workspaceFocus}`}>
        {productId !== undefined && onSelectBranch ? <ProductActivityHistory productId={productId} activeBranchId={activeBranchId} onSelectBranch={onSelectBranch} unit={unit} isDarkMode={isDarkMode} enabled={active === 'activity'} /> : <ProductActivityTimeline activities={activities} activeBranchId={activeBranchId} isDarkMode={isDarkMode} />}
      </div>
      <div role="tabpanel" id={`${id}-batches-panel`} aria-labelledby={`${id}-batches-tab`} hidden={active !== 'batches'} tabIndex={0} className={`p-4 sm:p-5 ${workspaceFocus}`}>
        {productId !== undefined ? <ProductBatchHistory productId={productId} unit={unit} isDarkMode={isDarkMode} enabled={active === 'batches'} /> : <ProductBatchBreakdown batches={batches} unit={unit} isDarkMode={isDarkMode} />}
      </div>
    </section>
  );
}
