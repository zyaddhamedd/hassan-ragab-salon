import React from 'react';
import type { PromoCode } from '../../admin/types';
import { promoStatus, promoScopeLabel } from '../../admin/utils/promoCodes';

interface Props {
  promo: PromoCode;
  now: number;
  canManage: boolean;
  disabled: boolean;
  pending: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onArchive: () => void;
  children: React.ReactNode;
}

export default function CouponArtifact({
  promo,
  now,
  canManage,
  disabled,
  pending,
  onEdit,
  onToggle,
  onArchive,
  children,
}: Props) {
  const status = promoStatus(promo, now);
  const value = Number(promo.discount_value).toLocaleString('en-US', { maximumFractionDigits: 2 });

  return (
    <article className="oc-artifact" dir="rtl">
      <div className="oc-frame">
        <div className="oc-housing">
          <div className="oc-top">
            <div className="oc-code-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="oc-tag-icon" aria-hidden="true">
                <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
                <path d="M7 7h.01" />
              </svg>
              <h2 className="oc-code" dir="ltr">{promo.code}</h2>
            </div>
            <span className="oc-status" data-status={status}>
              {status}
            </span>
          </div>

          <div className="oc-core">
            <div className="oc-scope">
              <strong>{promoScopeLabel(promo.discount_scope)}</strong>
              <span>
                {promo.discount_scope === 'PRODUCTS_ONLY'
                  ? ''
                  : promo.category_scope === 'ALL_SERVICE_CATEGORIES'
                  ? 'جميع فئات الخدمات'
                  : `فئات محددة (${promo.category_ids.length})`}
              </span>
            </div>
            <div className="oc-value" dir="ltr" data-long={value.length > 4}>
              <span className="oc-number"><bdi>{value}</bdi></span>
              <span className="oc-percent">{promo.discount_type === 'PERCENTAGE' ? '%' : 'ج.م'}</span>
            </div>
          </div>

          <div className="oc-cutline" aria-hidden="true" />

          {canManage ? (
            <div className="oc-actions">
              <button className="oc-action oc-edit" type="button" disabled={disabled} onClick={onEdit}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" />
                </svg>
                تعديل
              </button>
              <button className="oc-action oc-pause" type="button" disabled={disabled} onClick={onToggle}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d={promo.is_active ? 'M8 5v14M16 5v14' : 'm8 5 10 7-10 7Z'} />
                </svg>
                {promo.is_active ? 'إيقاف' : 'تفعيل'}
              </button>
              <button className="oc-action oc-archive" type="button" disabled={disabled} onClick={onArchive} aria-label="أرشفة" title="أرشفة">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 9v11h16V9M3 4h18v5H3ZM9 13h6" />
                </svg>
              </button>
            </div>
          ) : (
            <p className="oc-readonly">{promo.archived_at ? 'مؤرشف — محفوظ في السجل' : 'للعرض فقط ضمن صلاحيات فرعك'}</p>
          )}

          {pending && <p className="oc-readonly" role="status">جارٍ حفظ التغيير…</p>}

          <details className="oc-details">
            <summary>
              <span>التفاصيل</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            {children}
          </details>
        </div>
      </div>
    </article>
  );
}
