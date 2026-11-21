
import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Save, AlertCircle, ChevronDown, Check } from 'lucide-react';
import { Service, Category } from '../types';

interface BulkAddModalProps {
  isDarkMode: boolean;
  categories: Category[];
  initialCategoryId?: string;
  onClose: () => void;
  onSave: (services: Partial<Service>[]) => void;
}

interface ServiceRow {
  name: string;
  price: string;
  commission: string;
  id: string;
}

const BulkAddModal: React.FC<BulkAddModalProps> = ({
  isDarkMode,
  categories,
  initialCategoryId,
  onClose,
  onSave
}) => {
  const [rows, setRows] = useState<ServiceRow[]>([
    { id: Math.random().toString(36).substr(2, 9), name: '', price: '', commission: '15' }
  ]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [isChangingCategory, setIsChangingCategory] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSelectedCategoryId(initialCategoryId && initialCategoryId !== 'All'
      ? initialCategoryId
      : (categories[0]?.id || '')
    );
  }, [initialCategoryId, categories]);

  const addRow = () => {
    setRows([...rows, { id: Math.random().toString(36).substr(2, 9), name: '', price: '', commission: '15' }]);
  };

  const removeRow = (id: string) => {
    if (rows.length > 1) {
      setRows(rows.filter(row => row.id !== id));
    }
  };

  const updateRow = (id: string, field: keyof ServiceRow, value: string) => {
    setRows(rows.map(row => row.id === id ? { ...row, [field]: value } : row));
    if (errors[id]) {
      const newErrors = { ...errors };
      delete newErrors[id];
      setErrors(newErrors);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, boolean> = {};
    let hasError = false;

    rows.forEach(row => {
      if (!row.name || !row.price || isNaN(Number(row.price))) {
        newErrors[row.id] = true;
        hasError = true;
      }
    });

    if (hasError) {
      setErrors(newErrors);
      return;
    }

    const servicesToSave = rows.map(row => {
      const catId = Number(selectedCategoryId);
      // console.log('CRITICAL DEBUG BULK: Submitting with category_id:', catId);
      return {
        name: row.name,
        price: Number(row.price),
        commission: Number(row.commission),
        duration: '٤٥ دقيقة',
        category_id: catId
      };
    });

    onSave(servicesToSave);
  };

  const selectedCategoryName = categories.find(c => c.id === selectedCategoryId)?.name || 'غير محدد';

  return (
    <div className="admin-overlay-shell z-[120]" dir="rtl">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose}></div>
      <div className={`admin-overlay-panel relative w-full max-w-4xl overflow-y-auto rounded-[2.5rem] border animate-scale-in theme-transition ${isDarkMode ? 'bg-[#0F0F0F] border-white/10 shadow-2xl' : 'bg-white border-black/10 shadow-2xl'
        }`}>
        <div className={`p-8 border-b flex items-center justify-between ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
          <div>
            <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>إضافة مجموعة خدمات</h3>
            <p className="text-[10px] font-bold text-[#E53935] uppercase tracking-widest mt-1">إدخال بيانات متعددة في وقت واحد</p>
          </div>
          <button onClick={onClose} className={`p-2 rounded-full transition-all ${isDarkMode ? 'hover:bg-white/5 text-gray-500' : 'hover:bg-black/5 text-gray-400'}`}>
            <X size={20} />
          </button>
        </div>

        {/* Global Category Context Selector */}
        <div className={`px-8 py-4 border-b flex flex-col gap-3 ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>الصنف المحدد للمجموعة:</span>
              <span className={`text-xs font-bold text-[#E6D690]`}>{selectedCategoryName}</span>
            </div>
            <button
              onClick={() => setIsChangingCategory(!isChangingCategory)}
              className="text-[10px] font-bold text-[#E53935] hover:text-[#FF3B30] uppercase tracking-widest flex items-center gap-1 transition-all"
            >
              تغيير
              <ChevronDown size={12} className={`transition-transform duration-300 ${isChangingCategory ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {isChangingCategory && (
            <div className="flex flex-wrap gap-2 mt-2 animate-fade-in">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategoryId(cat.id);
                    setIsChangingCategory(false);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-[10px] font-bold transition-all ${selectedCategoryId === cat.id
                    ? 'bg-[#E53935]/10 border-[#E53935] text-white'
                    : (isDarkMode ? 'bg-white/5 border-white/5 text-gray-400 hover:border-white/20' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300')
                    }`}
                >
                  {cat.name}
                  {selectedCategoryId === cat.id && <Check size={10} className="text-[#E53935]" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-8 max-h-[50vh] overflow-y-auto custom-scrollbar">
          <table className="w-full text-right">
            <thead>
              <tr className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <th className="pb-4 px-2">اسم الخدمة</th>
                <th className="pb-4 px-2 w-32">السعر (ج.م)</th>
                <th className="pb-4 px-2 w-32">العمولة (%)</th>
                <th className="pb-4 px-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="space-y-2">
              {rows.map((row) => (
                <tr key={row.id} className={`group ${errors[row.id] ? 'bg-red-500/5' : ''}`}>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                      placeholder="اسم الخدمة..."
                      className={`w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all font-bold ${isDarkMode ? 'bg-[#161616] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                        } ${errors[row.id] && !row.name ? 'border-red-500/50' : ''}`}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      value={row.price}
                      onChange={(e) => updateRow(row.id, 'price', e.target.value)}
                      placeholder="0.00"
                      className={`w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all font-bold ${isDarkMode ? 'bg-[#161616] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                        } ${errors[row.id] && (!row.price || isNaN(Number(row.price))) ? 'border-red-500/50' : ''}`}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      value={row.commission}
                      onChange={(e) => updateRow(row.id, 'commission', e.target.value)}
                      placeholder="15"
                      className={`w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all font-bold ${isDarkMode ? 'bg-[#161616] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                        }`}
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      onClick={() => removeRow(row.id)}
                      className={`p-2 rounded-lg transition-all ${rows.length === 1 ? 'opacity-20 cursor-not-allowed' : 'text-gray-500 hover:text-[#E53935] hover:bg-[#E53935]/10'}`}
                      disabled={rows.length === 1}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={addRow}
            className={`mt-6 w-full py-4 rounded-2xl border-2 border-dashed flex items-center justify-center gap-2 text-xs font-bold transition-all ${isDarkMode ? 'border-white/5 text-gray-500 hover:border-[#E53935]/30 hover:text-white hover:bg-white/5' : 'border-gray-200 text-gray-400 hover:border-[#E53935]/30 hover:text-gray-900 hover:bg-gray-50'
              }`}
          >
            <Plus size={16} />
            إضافة صف جديد
          </button>
        </div>

        <div className={`p-8 border-t flex items-center justify-between ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
          <div className="flex items-center gap-2 text-[#E53935] opacity-60">
            {Object.keys(errors).length > 0 && (
              <>
                <AlertCircle size={14} />
                <span className="text-[10px] font-bold">يرجى تصحيح الأخطاء الموضحة</span>
              </>
            )}
          </div>
          <div className="flex gap-4">
            <button
              onClick={onClose}
              className={`px-8 py-4 rounded-2xl text-xs font-bold border transition-all ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-gray-900 hover:bg-black/5'
                }`}
            >
              إلغاء
            </button>
            <button
              onClick={handleSubmit}
              className="px-12 py-4 bg-[#E53935] hover:bg-[#FF3B30] text-white rounded-2xl text-xs font-bold shadow-xl shadow-red-900/20 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <Save size={16} />
              إضافة جميع الخدمات ({rows.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkAddModal;
