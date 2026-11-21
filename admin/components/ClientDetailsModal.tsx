
import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Phone,
  MapPin,
  Star,
  Activity,
  Maximize2,
  ChevronLeft,
  Scissors,
  Wallet,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { Client } from '../types';
import adminApi from '../api/client';

interface ClientDetailsModalProps {
  client: Client;
  isDarkMode: boolean;
  selectedBranch: string;
  onClose: () => void;
  onToggleStar?: (client: Client) => void;
}

const ClientDetailsModal: React.FC<ClientDetailsModalProps> = ({ client, isDarkMode, selectedBranch, onClose, onToggleStar }) => {
  const [isPhotoLightboxOpen, setIsPhotoLightboxOpen] = useState(false);
  const [details, setDetails] = useState<Client | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(true);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [showAllVisits, setShowAllVisits] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const fetchDetails = async () => {
      setIsLoadingDetails(true);
      setDetailsError(null);
      setShowAllVisits(false);

      try {
        const response = await adminApi.get(`/customers/${client.id}`);
        if (isCancelled) {
          return;
        }

        setDetails({
          ...client,
          name: response.data.full_name || client.name,
          phone: response.data.phone || client.phone,
          visits: response.data.visits_count ?? client.visits,
          totalSpend: response.data.total_spend ?? client.totalSpend,
          lastVisit: response.data.last_visit || client.lastVisit,
          primaryBranch: response.data.branch || client.primaryBranch,
          lastBarberName: response.data.last_barber_name ?? client.lastBarberName ?? client.last_barber_name ?? null,
          last_barber_name: response.data.last_barber_name ?? client.last_barber_name ?? client.lastBarberName ?? null,
          customerSince: response.data.customer_since ?? client.customerSince ?? null,
          depositBalance: response.data.deposit_balance ?? client.depositBalance ?? 0,
          photoUrl: response.data.photo_url ?? client.photoUrl,
          notes: response.data.notes ?? client.notes,
          recentVisits: Array.isArray(response.data.all_visits)
            ? response.data.all_visits
            : Array.isArray(response.data.recent_visits)
              ? response.data.recent_visits
              : client.recentVisits || [],
        });
      } catch (error: any) {
        if (!isCancelled) {
          console.error('Failed to fetch client details:', error);
          setDetailsError(error?.response?.data?.error || error?.message || 'تعذر تحميل تفاصيل العميل.');
          setDetails(client);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingDetails(false);
        }
      }
    };

    fetchDetails();

    return () => {
      isCancelled = true;
    };
  }, [client]);

  const effectiveClient = details || client;
  const lastBarberName = effectiveClient.lastBarberName || effectiveClient.last_barber_name;
  const allVisits = effectiveClient.recentVisits || [];
  const visibleVisits = useMemo(
    () => (showAllVisits ? allVisits : allVisits.slice(0, 5)),
    [allVisits, showAllVisits]
  );

  // Determine if the star is filled based on the current context
  const isStarredInContext = selectedBranch === 'All'
    ? effectiveClient.starredBranches.length > 0
    : effectiveClient.starredBranches.includes(selectedBranch);

  return (
    <div className="admin-overlay-shell z-[110]" dir="rtl">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-xl" onClick={onClose}></div>
      <div className={`admin-overlay-panel relative w-full max-w-3xl rounded-[3.5rem] border animate-scale-in theme-transition ${isDarkMode ? 'bg-[#0F0F0F] border-white/10 shadow-2xl' : 'bg-white border-black/10 shadow-2xl'
        }`}>

        {/* HEADER – IDENTITY */}
        <div className={`p-10 border-b flex items-center justify-between ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
          <div className="flex items-center gap-8">
            <button
              onClick={() => setIsPhotoLightboxOpen(true)}
              className="relative group transition-transform active:scale-95"
            >
              {effectiveClient.photoUrl ? (
                <div className="w-20 h-20 rounded-[2rem] overflow-hidden border-4 border-[#E6D690] shadow-xl">
                  <img src={effectiveClient.photoUrl} alt={effectiveClient.name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div
                  className="w-20 h-20 rounded-[2rem] flex items-center justify-center text-white font-bold text-3xl shadow-xl border-4 border-current"
                  style={{ backgroundColor: effectiveClient.avatarColor || '#E53935' }}
                >
                  {effectiveClient.name.charAt(0)}
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-[2rem]">
                <Maximize2 size={24} className="text-white" />
              </div>
            </button>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-5">
                <h2 className={`text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{effectiveClient.name}</h2>
                <button
                  onClick={() => onToggleStar?.(effectiveClient)}
                  className={`p-2 transition-all transform hover:scale-125 active:scale-90 ${isStarredInContext
                    ? 'text-[#E6D690] drop-shadow-[0_0_8px_rgba(230,214,144,0.4)]'
                    : 'text-gray-500 opacity-20 hover:opacity-100'
                    }`}
                >
                  <Star
                    size={32}
                    fill={isStarredInContext ? 'currentColor' : 'none'}
                    strokeWidth={isStarredInContext ? 0 : 2}
                  />
                </button>
              </div>
              <div className="flex items-center gap-2 opacity-60">
                <Phone size={14} className="text-[#E53935]" />
                <span className="text-sm font-bold tracking-widest">{effectiveClient.phone}</span>
              </div>
            </div>
          </div>

          <button onClick={onClose} className={`p-4 rounded-full transition-all ${isDarkMode ? 'hover:bg-white/5 text-gray-500' : 'hover:bg-black/5 text-gray-400'}`}>
            <X size={28} />
          </button>
        </div>

        {/* CONTENT AREA (SINGLE VIEW) */}
        <div className="admin-overlay-body custom-scrollbar p-10 space-y-12">

          {/* SECTION 2: BRANCH INFO */}
          <div className="space-y-4">
            <div className="flex items-center gap-3 opacity-40">
              <MapPin size={16} />
              <h4 className="text-[10px] font-bold uppercase tracking-[0.2em]">معلومات النطاق الجغرافي</h4>
            </div>
            <div className={`p-8 rounded-[2rem] border flex items-center justify-between ${isDarkMode ? 'bg-white/[0.01] border-white/5' : 'bg-gray-50 border-black/5'}`}>
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">الفرع الأساسي (الأكثر زيارة)</span>
                <span className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{effectiveClient.primaryBranch}</span>
              </div>

              {/* Last barber from the latest paid service invoice */}
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">آخر مصفف</span>
                <div className="flex items-center gap-2">
                  <Scissors size={14} className={isDarkMode ? 'text-white' : 'text-gray-900'} />
                  <span className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {lastBarberName || 'غير محدد'}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">إجمالي الزيارات</span>
                <span className="text-lg font-bold text-[#E6D690] block">{effectiveClient.visits}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3 opacity-40">
              <Wallet size={16} />
              <h4 className="text-[10px] font-bold uppercase tracking-[0.2em]">رصيد العربون</h4>
            </div>
            <div className={`p-8 rounded-[2rem] border flex items-center justify-between ${isDarkMode ? 'bg-white/[0.01] border-white/5' : 'bg-gray-50 border-black/5'}`}>
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">الرصيد الحالي لهذا الفرع</span>
                <span className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {(effectiveClient.depositBalance || 0).toLocaleString('en-US')} <span className="text-sm font-normal text-[#E6D690]">EGP</span>
                </span>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-1">النطاق</span>
                <span className={`text-sm font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {effectiveClient.primaryBranch}
                </span>
              </div>
            </div>
          </div>

          {/* SECTION 3: RECENT ACTIVITY (Last 5) */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 opacity-40">
                <Activity size={16} />
                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em]">{showAllVisits ? 'كل الزيارات' : 'آخر ٥ زيارات'}</h4>
              </div>
              {allVisits.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllVisits((current) => !current)}
                  className="text-[9px] font-bold text-[#E53935] uppercase tracking-widest hover:underline flex items-center gap-1"
                >
                  {showAllVisits ? 'عرض آخر ٥ فقط' : 'عرض كل الزيارات'} <ChevronLeft size={10} />
                </button>
              )}
            </div>

            <div className={`rounded-[2rem] border overflow-hidden ${isDarkMode ? 'bg-white/[0.01] border-white/5' : 'bg-gray-50 border-black/5'}`}>
              <table className="w-full text-right">
                <thead>
                  <tr className={`text-[9px] font-bold text-gray-500 uppercase tracking-widest border-b ${isDarkMode ? 'bg-white/5' : 'bg-white/50'}`}>
                    <th className="px-8 py-5">التاريخ</th>
                    <th className="px-8 py-5">الفرع</th>
                    <th className="px-8 py-5 text-left">قيمة الفاتورة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {isLoadingDetails ? (
                    <tr>
                      <td colSpan={3} className="py-12 text-center text-[11px] font-bold opacity-50">
                        <span className="inline-flex items-center gap-2">
                          <RefreshCw size={14} className="animate-spin" />
                          جاري تحميل سجل الزيارات...
                        </span>
                      </td>
                    </tr>
                  ) : detailsError ? (
                    <tr>
                      <td colSpan={3} className="py-12 text-center text-[11px] font-bold text-red-400">
                        <span className="inline-flex items-center gap-2">
                          <AlertCircle size={14} />
                          {detailsError}
                        </span>
                      </td>
                    </tr>
                  ) : visibleVisits.length > 0 ? visibleVisits.map(v => (
                    <tr key={v.id} className="text-[11px] font-bold">
                      <td className="px-8 py-5 opacity-60">{v.date}</td>
                      <td className="px-8 py-5">{v.branch}</td>
                      <td className="px-8 py-5 text-left text-[#E53935]">{v.total.toLocaleString()} ج.م</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3} className="py-12 text-center opacity-30 text-[10px] font-bold uppercase tracking-widest">لا توجد سجلات حديثة</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* SECTION 4: NOTES */}
          <div className="space-y-4 pt-6 border-t border-white/5">
            <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">ملاحظات إدارية</span>
            <p className={`text-xs font-bold leading-relaxed opacity-60 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              {effectiveClient.notes || 'لا توجد ملاحظات مسجلة لهذا العميل.'}
            </p>
          </div>
        </div>

        {/* FOOTER ACTIONS */}
        <div className={`p-10 border-t flex justify-between items-center ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
          <button className="text-red-500 text-[10px] font-bold uppercase tracking-[0.2em] hover:opacity-70 transition-all flex items-center gap-2">
            حذف السجل
          </button>
          <div className="flex gap-4">
            <button onClick={onClose} className={`px-10 py-4 rounded-2xl text-[10px] font-bold border uppercase tracking-widest transition-all ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-gray-900 hover:bg-black/5'}`}>إغلاق</button>
            <button className="bg-[#E53935] hover:bg-[#FF3B30] text-white px-14 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-2xl shadow-red-900/30 transition-all">
              تحديث البيانات
            </button>
          </div>
        </div>
      </div>

      {/* PHOTO LIGHTBOX */}
      {isPhotoLightboxOpen && (
        <div className="admin-overlay-shell z-[200] bg-black/95 animate-fade-in backdrop-blur-xl">
          <button
            onClick={() => setIsPhotoLightboxOpen(false)}
            className="absolute top-8 right-8 text-white/40 hover:text-white p-3 rounded-full border border-white/10 transition-all"
          >
            <X size={32} />
          </button>
          <div className="relative max-w-2xl max-h-[80vh]">
            {effectiveClient.photoUrl ? (
              <img src={effectiveClient.photoUrl} alt={effectiveClient.name} className="w-full h-full object-contain rounded-2xl shadow-2xl" />
            ) : (
              <div className="w-64 h-64 rounded-[3rem] flex items-center justify-center text-white font-bold text-8xl shadow-2xl" style={{ backgroundColor: effectiveClient.avatarColor || '#E53935' }}>
                {effectiveClient.name.charAt(0)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientDetailsModal;
