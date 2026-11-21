import React, { useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, Minus } from 'lucide-react';
import { ProductWorkspaceActivity } from '../../types';
import { workspaceStyles } from './productWorkspaceStyles';
import ProductMovementBadge from './ProductMovementBadge';
import ProductMovementLegend from './ProductMovementLegend';

interface ProductActivityTimelineProps {
  isDarkMode?: boolean;
  activities: ProductWorkspaceActivity[];
  activeBranchId: number | null;
}

const ProductActivityTimeline: React.FC<ProductActivityTimelineProps> = ({ activities, activeBranchId, isDarkMode = true }) => {
  const filteredActivities = useMemo(() => {
    if (activeBranchId === null) return activities;
    return activities.filter((activity) => activity.branch_id === activeBranchId);
  }, [activities, activeBranchId]);

  const formatDate = (value: string) => {
    if (!value) return '---';
    try {
      return new Intl.DateTimeFormat('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch {
      return value;
    }
  };

  const getDirectionIcon = (direction: ProductWorkspaceActivity['direction']) => {
    if (direction === 'IN') return <ArrowUpRight size={14} aria-hidden="true" />;
    if (direction === 'OUT') return <ArrowDownLeft size={14} aria-hidden="true" />;
    return <Minus size={14} aria-hidden="true" />;
  };

  const getSignedText = (activity: ProductWorkspaceActivity) => {
    if (activity.direction === 'IN') return `+${activity.quantity}`;
    if (activity.direction === 'OUT') return `-${activity.quantity}`;
    return `${activity.quantity}`;
  };

  const tone = workspaceStyles(isDarkMode);
  return (
    <section aria-label="آخر الحركات المسجلة" className="space-y-3">
      <h2 className="text-sm font-black">آخر الحركات المسجلة</h2>
      <ProductMovementLegend isDarkMode={isDarkMode} legacyLabels />
      {filteredActivities.length === 0 ? (
        <p className={`rounded-xl border border-dashed px-4 py-6 text-center text-sm ${tone.divider} ${tone.muted}`}>
          {activeBranchId === null ? 'لا توجد حركة مسجلة لهذا المنتج حالياً.' : 'لا توجد حركة مسجلة لهذا الفرع حالياً.'}
        </p>
      ) : (
        <ol className={`divide-y ${isDarkMode ? 'divide-white/[0.08]' : 'divide-gray-200'}`}>
          {filteredActivities.map((activity) => (
            <li key={activity.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ProductMovementBadge type={activity.movement_type} isDarkMode={isDarkMode} legacyLabels />
                  <p className="break-words text-sm font-bold">{activity.reference_label || 'حركة مخزنية'}</p>
                </div>
                <div className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${tone.muted}`}>
                  <span>{activity.branch_name}</span>
                  <time dateTime={activity.created_at}>{formatDate(activity.created_at)}</time>
                </div>
                {activity.notes && <p className={`mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 ${tone.muted}`}>{activity.notes}</p>}
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-black tabular-nums ${activity.direction === 'IN' ? tone.healthy : activity.direction === 'OUT' ? tone.expired : tone.unavailable}`} aria-label={`الكمية: ${getSignedText(activity)}`}>
                {getDirectionIcon(activity.direction)}<bdi dir="ltr">{getSignedText(activity)}</bdi>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export default ProductActivityTimeline;
