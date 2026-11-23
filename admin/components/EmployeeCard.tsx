import React, { useState } from 'react';
import { Employee, ROLE_LABELS } from '../types';
import {
  MapPin,
  ArrowLeftRight,
  MoreVertical,
  Edit,
  Trash2,
  UserX,
  UserCheck,
  Scissors,
} from 'lucide-react';

interface EmployeeCardProps {
  employee: Employee;
  isDarkMode: boolean;
  onViewDetails: (employee: Employee) => void;
  onEdit: (employee: Employee) => void;
  onFinancials: (employee: Employee) => void;
  onDelete?: (employee: Employee) => void;
  onToggleStatus?: (employee: Employee) => void;
}

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.trim().charAt(0) || 'م';
};

const EmployeeCard: React.FC<EmployeeCardProps> = ({
  employee,
  isDarkMode,
  onViewDetails,
  onFinancials,
  onEdit,
  onDelete,
  onToggleStatus,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const hasPhoto = Boolean(employee.photoUrl && !imgError);
  const isActive = employee.status === 'نشط';
  const roleLabel = ROLE_LABELS[employee.role] || employee.role;

  return (
    <article
      onClick={() => onViewDetails(employee)}
      className={`group relative w-full max-w-[275px] mx-auto rounded-[20px] border transition-all duration-300 ease-out cursor-pointer select-none flex flex-col justify-between overflow-hidden ${
        isDarkMode
          ? 'bg-[#121215] border-white/10 hover:border-[#E6D690]/40 shadow-xl hover:shadow-[0_16px_32px_-8px_rgba(0,0,0,0.8)] hover:-translate-y-1'
          : 'bg-[#18181C] border-white/10 hover:border-[#E6D690]/40 shadow-md hover:shadow-xl hover:-translate-y-1'
      } ${employee.is_deleted ? 'opacity-60' : ''}`}
      style={{ height: '385px' }}
      dir="rtl"
    >
      {/* 1. Integrated Physical Badge Header Rim & Notch */}
      <div className="relative pt-3 px-3.5 pb-2 shrink-0 flex items-center justify-between z-20">
        {/* Branch Transfer Action */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFinancials(employee);
          }}
          className="w-7 h-7 rounded-lg border bg-white/5 border-white/10 text-gray-400 hover:text-[#E6D690] hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer"
          title="نقل الفرع"
          aria-label="نقل الموظف لفرع آخر"
        >
          <ArrowLeftRight size={13} />
        </button>

        {/* Lanyard slot cutout & subtle Club brandmark */}
        <div className="flex flex-col items-center gap-1 min-w-0">
          <div
            className="w-10 h-1.5 rounded-full bg-[#08080A] border border-white/10 shadow-inner"
            aria-hidden="true"
          />
          <span className="font-mono text-[8px] font-bold tracking-[0.25em] text-[#E6D690]/80 uppercase truncate">
            HASSAN RAGAB SALON
          </span>
        </div>

        {/* Context Menu Action */}
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsMenuOpen((prev) => !prev);
            }}
            className="w-7 h-7 rounded-lg border bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center cursor-pointer"
            title="خيارات إضافية"
            aria-label="خيارات الموظف"
          >
            <MoreVertical size={13} />
          </button>

          {/* Context Dropdown Menu */}
          {isMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMenuOpen(false);
                }}
              />
              <div
                className="absolute top-full left-0 mt-1.5 w-44 rounded-xl shadow-2xl border overflow-hidden z-50 animate-fade-in bg-[#181818] border-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onEdit(employee);
                  }}
                  className="w-full text-right px-3.5 py-2.5 text-xs font-bold flex items-center gap-2 text-gray-200 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <Edit size={13} className="text-[#E6D690]" />
                  <span>تعديل البيانات</span>
                </button>

                {onToggleStatus && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onToggleStatus(employee);
                    }}
                    className="w-full text-right px-3.5 py-2.5 text-xs font-bold flex items-center gap-2 text-gray-200 hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    {isActive ? (
                      <>
                        <UserX size={13} className="text-orange-400" />
                        <span>إيقاف الحساب</span>
                      </>
                    ) : (
                      <>
                        <UserCheck size={13} className="text-emerald-400" />
                        <span>تنشيط الحساب</span>
                      </>
                    )}
                  </button>
                )}

                {onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onDelete(employee);
                    }}
                    className="w-full text-right px-3.5 py-2.5 text-xs font-bold flex items-center gap-2 text-rose-400 hover:bg-rose-500/10 border-t border-white/5 transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>حذف الموظف</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 2. Unified Credential Face (Seamless Portrait + Integrated Ivory ID Plate) */}
      <div className="mx-3.5 mb-3.5 flex-1 flex flex-col rounded-xl overflow-hidden border border-white/10 shadow-inner">
        {/* Upper Portion: Hero Portrait or Large Elegant Monogram */}
        <div className="relative flex-1 min-h-[180px] bg-[#141417] flex items-center justify-center overflow-hidden">
          {hasPhoto ? (
            <img
              src={employee.photoUrl}
              alt={employee.name}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            /* Elegant, Large, Minimal Monogram */
            <div className="w-full h-full flex items-center justify-center relative p-4 bg-gradient-to-b from-[#1C1C20] to-[#101013]">
              <Scissors size={80} className="absolute text-white/[0.03] pointer-events-none" />
              <div className="w-16 h-16 rounded-full border border-[#E6D690]/25 bg-white/[0.02] flex items-center justify-center shadow-lg">
                <span className="font-mono text-3xl font-black text-[#E6D690] tracking-wider">
                  {getInitials(employee.name)}
                </span>
              </div>
            </div>
          )}

          {/* Soft Vignette Overlay for Crisp Status Contrast */}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 via-black/25 to-transparent pointer-events-none" />

          {/* Status Micro-Badge (Attached to lower-right corner of portrait) */}
          <div className="absolute bottom-2 right-2 z-10">
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold backdrop-blur-md border ${
                isActive
                  ? 'bg-black/70 border-emerald-500/30 text-emerald-300'
                  : 'bg-black/70 border-orange-500/30 text-orange-300'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isActive ? 'bg-emerald-400 animate-pulse' : 'bg-orange-400'
                }`}
              />
              <span>{isActive ? 'نشط' : 'موقوف'}</span>
            </span>
          </div>

          {/* Internal ID on the lower-left corner of portrait if available */}
          {employee.internalId && (
            <div className="absolute bottom-2 left-2 z-10">
              <span
                className="font-mono text-[9px] font-bold text-gray-200 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/10"
                dir="ltr"
              >
                #{employee.internalId}
              </span>
            </div>
          )}
        </div>

        {/* Lower Portion: Integrated Dark Identification Plate (Bonded directly beneath portrait) */}
        <div className="bg-[#18181B] text-white border-t border-white/10 p-3 flex flex-col justify-between shrink-0">
          {/* Header Row: Role Title & Department Mark */}
          <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1.5">
            <span className="text-xs font-black tracking-tight text-[#E6D690]">
              {roleLabel}
            </span>
            <span className="text-[9px] font-mono font-bold text-white/40 uppercase tracking-wider">
              CREW
            </span>
          </div>

          {/* Middle Row: Full Name with Single-Line Truncation */}
          <h3
            className={`text-[17px] font-extrabold text-white truncate tracking-tight leading-tight ${
              employee.is_deleted ? 'line-through opacity-50' : ''
            }`}
            title={employee.name}
          >
            {employee.name}
          </h3>

          {/* Bottom Row: Assigned Branch & Phone */}
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/70 font-medium">
            <span className="flex items-center gap-1 truncate max-w-[155px]" title={employee.branch}>
              <MapPin size={11} className="text-[#E6D690] shrink-0" />
              <span className="truncate">{employee.branch}</span>
            </span>

            {employee.phone ? (
              <span className="font-mono text-[9px] text-white/50 truncate" dir="ltr">
                {employee.phone}
              </span>
            ) : (
              <span className="font-mono text-[9px] text-white/35">---</span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Archived/Deleted Watermark Stamp Overlay */}
      {employee.is_deleted && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] rounded-[20px] flex items-center justify-center z-30 pointer-events-none">
          <span className="px-3.5 py-1 rounded bg-red-950/90 border border-red-500/50 text-red-200 font-bold text-xs tracking-wider shadow-lg">
            سجل محذوف
          </span>
        </div>
      )}
    </article>
  );
};

export default EmployeeCard;
