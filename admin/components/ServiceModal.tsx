import React, { useState, useEffect } from 'react';
import adminApi from '../api/client';
import { X, Save, Scissors, ChevronDown, Check, Loader2, MapPin, AlertTriangle } from 'lucide-react';
import { Service, Category } from '../types';

interface ServiceModalProps {
  isDarkMode: boolean;
  service: Service | null;
  categories: Category[];
  initialCategoryId?: string;
  selectedBranch: string;
  onClose: () => void;
  onRefresh: (newService?: any) => void;
}

const ServiceModal: React.FC<ServiceModalProps> = ({
  isDarkMode,
  service,
  categories,
  initialCategoryId,
  selectedBranch,
  onClose,
  onRefresh
}) => {
  const [formData, setFormData] = useState<Partial<Service>>({
    name: '',
    price: 0,
    commission: 0,
    category: ''
  });

  const [isChangingCategory, setIsChangingCategory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (service) {
      setFormData({
        ...service,
        commission: service.barber_commission_percent || 0 // Map backend field to form field
      });
    } else {
      setFormData(prev => ({
        ...prev,
        category: initialCategoryId && initialCategoryId !== 'All'
          ? initialCategoryId
          : (categories[0]?.id || '')
      }));
    }
  }, [service, initialCategoryId, categories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (categories.length === 0) {
      setError('يرجى إنشاء تصنيف خدمات أولاً قبل البدء');
      return;
    }

    setIsSaving(true);
    try {
      if (service) {
        // 2. Update Existing Service
        console.log(`🔥 UPDATING SERVICE: ${service.id}`);
        const updateRes = await adminApi.put(`/services/${service.id}`, {
          name: formData.name,
          category_id: Number(formData.category),
          barber_commission_percent: formData.commission,
          price: formData.price
        });

        console.log("✅ UPDATE SUCCESS:", updateRes.data);
        onRefresh(updateRes.data); // Return full object to update local state
        onClose();
        return;
      }

      // 3. Create New Service
      const categoryId = Number(formData.category);
      console.log('CRITICAL DEBUG: Submitting service with category_id:', categoryId);

      if (isNaN(categoryId) || categoryId <= 0) {
        setError('يرجى اختيار تصنيف صحيح');
        setIsSaving(false);
        return;
      }

      const serviceRes = await adminApi.post('/services', {
        name: formData.name,
        category_id: categoryId,
        barber_commission_percent: formData.commission,
        price: formData.price // Include price in initial creation for local consistency
      });

      console.log("🔥 MODAL: Service created:", serviceRes.data);
      console.log("🔥 MODAL: Response has commission:", serviceRes.data.barber_commission_percent);

      // Return the new service data to parent for local update
      // Backend returns flat object with barber_commission_percent
      onRefresh(serviceRes.data);
      onClose();
    } catch (err: any) {
      console.error("❌ MODAL ERROR:", err);
      setError(err.response?.data?.error || 'فشل في حفظ الخدمة');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCategoryName = categories.find(c => c.id === formData.category)?.name || 'غير محدد';

  return (
    <div className="admin-overlay-shell z-[110]" dir="rtl">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose}></div>
      <div className={`admin-overlay-panel relative w-full max-w-lg overflow-y-auto rounded-[2.5rem] border animate-scale-in theme-transition ${isDarkMode ? 'bg-[#0F0F0F] border-white/10 shadow-2xl' : 'bg-white border-black/10 shadow-2xl'
        }`}>
        <div className={`p-8 border-b flex items-center justify-between ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#E53935] text-white flex items-center justify-center shadow-lg shadow-red-900/20">
              <Scissors size={24} />
            </div>
            <div>
              <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {service ? 'تعديل الخدمة' : 'إضافة خدمة جديدة'}
              </h3>
              <p className="text-[10px] font-bold text-[#E53935] uppercase tracking-widest mt-1">تحديد المعايير التشغيلية</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-2 rounded-full transition-all ${isDarkMode ? 'hover:bg-white/5 text-gray-500' : 'hover:bg-black/5 text-gray-400'}`}>
            <X size={20} />
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="px-8 pt-6">
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 animate-fade-in">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <p className="text-[11px] font-bold leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {/* Category Context Display */}
        <div className={`px-8 py-4 border-b flex flex-col gap-3 ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>الصنف الحالي:</span>
              <span className={`text-xs font-bold text-[#E6D690]`}>{selectedCategoryName}</span>
            </div>
            <button
              onClick={() => setIsChangingCategory(!isChangingCategory)}
              className="text-[10px] font-bold text-[#E53935] hover:text-[#FF3B30] uppercase tracking-widest flex items-center gap-1 transition-all"
            >
              {categories.length === 0 ? 'يرجى إنشاء تصنيف أولاً' : 'تغيير'}
              <ChevronDown size={12} className={`transition-transform duration-300 ${isChangingCategory ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {isChangingCategory && (
            <div className="grid grid-cols-2 gap-2 mt-2 animate-fade-in">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setFormData({ ...formData, category: cat.id });
                    setIsChangingCategory(false);
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl border text-[10px] font-bold transition-all ${formData.category === cat.id
                    ? 'bg-[#E53935]/10 border-[#E53935] text-white'
                    : (isDarkMode ? 'bg-white/5 border-white/5 text-gray-400 hover:border-white/20' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300')
                    }`}
                >
                  {cat.name}
                  {formData.category === cat.id && <Check size={10} className="text-[#E53935]" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>اسم الخدمة</label>
            <input
              type="text"
              required
              disabled={isSaving}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={`w-full px-5 py-4 rounded-2xl border text-sm outline-none transition-all font-bold ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                } disabled:opacity-50`}
              placeholder="مثال: حلاقة ملكية فاخرة..."
            />
          </div>

          <div className="space-y-2">
            <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>السعر (ج.م)</label>
            <input
              type="number"
              required
              disabled={isSaving}
              value={formData.price || ''}
              onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
              className={`w-full px-5 py-4 rounded-2xl border text-sm outline-none transition-all font-bold ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                } disabled:opacity-50`}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>إجمالي نسبة العمولة (%)</label>
            <input
              type="number"
              required
              disabled={isSaving}
              value={formData.commission ?? ''}
              onChange={(e) => setFormData({ ...formData, commission: e.target.value === '' ? null : Number(e.target.value) })}
              className={`w-full px-5 py-4 rounded-2xl border text-sm outline-none transition-all font-bold ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                } disabled:opacity-50`}
              placeholder="0"
            />
          </div>

          <div className="pt-4 flex gap-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className={`flex-1 py-4 rounded-2xl text-xs font-bold border transition-all ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-gray-900 hover:bg-black/5'
                } disabled:opacity-50`}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-[2] bg-[#E53935] hover:bg-[#FF3B30] text-white py-4 rounded-2xl text-xs font-bold transition-all shadow-xl shadow-red-900/20 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Save size={16} />
                  {service ? 'حفظ التعديلات' : 'تأكيد وإضافة'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ServiceModal;
