
import React, { useState, useEffect } from 'react';
import adminApi from '../api/client';
import { X, Plus, Trash2, Check, Edit2, GripVertical } from 'lucide-react';
import { Category } from '../types';

interface CategoryManagementModalProps {
  isDarkMode: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  onUpdate?: (categories: Category[]) => void;
}

const CategoryManagementModal: React.FC<CategoryManagementModalProps> = ({ isDarkMode, onClose, onRefresh, onUpdate }) => {
  const [localCategories, setLocalCategories] = useState<Category[]>([]);
  const [originalCategories, setOriginalCategories] = useState<Category[]>([]);
  const [newCatName, setNewCatName] = useState('');
  const [newCatCommissionType, setNewCatCommissionType] = useState<'barber_only' | 'barber_and_assistant'>('barber_only');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingCommissionType, setEditingCommissionType] = useState<'barber_only' | 'barber_and_assistant'>('barber_only');
  const [isSaving, setIsSaving] = useState(false);

  // Sync Channel
  const syncChannel = new BroadcastChannel('salon_data_sync');

  // Fetch categories locally to avoid prop drilling issues
  React.useEffect(() => {
    const fetchCats = async () => {
      try {
        const response = await adminApi.get('/service-categories');
        const sorted = response.data.sort((a: any, b: any) => b.id - a.id);
        const formatted = sorted.map((cat: any) => ({
          id: cat.id.toString(),
          name: cat.name,
          commissionType: cat.commission_type?.toLowerCase() || 'barber_only',
          order: 0
        }));
        setLocalCategories(formatted);
        setOriginalCategories(JSON.parse(JSON.stringify(formatted)));
      } catch (err) {
        console.error('Error fetching categories:', err);
      }
    };
    fetchCats();
  }, []);

  const handleAdd = () => {
    if (!newCatName.trim()) return;

    // LOCAL ADD ONLY (STAGING)
    // No API call, no modal close
    const newCat: Category = {
      id: `temp-${Date.now()}`,
      name: newCatName.trim(),
      order: localCategories.length + 1,
      commissionType: newCatCommissionType
    };

    setLocalCategories([newCat, ...localCategories]);
    setNewCatName('');
    setNewCatCommissionType('barber_only');
    // console.log('📝 Staged new category locally:', newCat);
  };

  const handleConfirmSave = async () => {
    // 1. Check for unsaved input and stage it automatically
    let currentCategories = [...localCategories];
    if (newCatName.trim()) {
      const stagedCat: Category = {
        id: `temp-${Date.now()}`,
        name: newCatName.trim(),
        order: currentCategories.length + 1,
        commissionType: newCatCommissionType
      };
      currentCategories = [stagedCat, ...currentCategories];
      setLocalCategories(currentCategories);
      setNewCatName('');
      // console.log('📝 Auto-staged pending input before save:', stagedCat);
    }

    const pendingCreate = currentCategories.filter(c => c.id.toString().startsWith('temp-'));

    // Find modified existing categories
    const pendingUpdate = currentCategories.filter(c => {
      if (c.id.toString().startsWith('temp-')) return false;
      const original = originalCategories.find(orig => orig.id === c.id);
      return original && (original.name !== c.name || original.commissionType !== c.commissionType);
    });

    if (pendingCreate.length === 0 && pendingUpdate.length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      // console.log('🚀 Syncing categories...');

      // 1. Create New
      for (const cat of pendingCreate) {
        const payload = {
          name: cat.name,
          commission_type: cat.commissionType === 'barber_and_assistant' ? 'BARBER_AND_ASSISTANT' : 'BARBER_ONLY'
        };
        await adminApi.post('/service-categories', payload);
      }

      // 2. Update Existing
      for (const cat of pendingUpdate) {
        const payload = {
          name: cat.name,
          commission_type: cat.commissionType === 'barber_and_assistant' ? 'BARBER_AND_ASSISTANT' : 'BARBER_ONLY'
        };
        await adminApi.put(`/service-categories/${cat.id}`, payload);
      }

      // console.log('✅ All categories synced.');
      syncChannel.postMessage({ type: 'REFETCH_DATA' });

      onUpdate?.(localCategories);
      onRefresh?.();
      onClose();
    } catch (err: any) {
      console.error('❌ Sync Error:', err);
      const errorMsg = err.response?.data?.details || err.response?.data?.error || 'فشل في حفظ التصنيفات';
      alert(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا التصنيف؟')) return;

    // Case 1: Temp Category (Just remove from state)
    if (id.toString().startsWith('temp-')) {
      const updated = localCategories.filter(c => c.id !== id);
      setLocalCategories(updated);
      return;
    }

    // Case 2: Real Category (API Call)
    try {
      // console.log(`🗑️ DELETING CATEGORY: ${id}`);
      const response = await adminApi.delete(`/service-categories/${id}`);
      // console.log('✅ CATEGORY DELETE RESPONSE:', response.data);

      const updated = localCategories.filter(c => c.id !== id);
      setLocalCategories(updated);

      // console.log('📢 BROADCASTING REFETCH_DATA');
      syncChannel.postMessage({ type: 'REFETCH_DATA' });

      onUpdate?.(updated);
      onRefresh?.();
    } catch (err: any) {
      console.error('❌ CATEGORY DELETE ERROR:', err);
      const errorMsg = err.response?.data?.error || 'فشل في حذف التصنيف';
      alert(errorMsg);
    }
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditingName(cat.name);
    setEditingCommissionType(cat.commissionType || 'barber_only');
  };

  const saveEdit = () => {
    if (!editingId || !editingName.trim()) return;
    const updated = localCategories.map(c => c.id === editingId ? { ...c, name: editingName.trim(), commissionType: editingCommissionType } : c);
    setLocalCategories(updated);
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex">
      <div className="absolute inset-0" onClick={onClose}></div>
      <div className={`relative modal-content m-auto w-full max-w-md rounded-[2.5rem] border overflow-hidden animate-scale-in theme-transition ${isDarkMode ? 'bg-[#0F0F0F] border-white/10 shadow-2xl' : 'bg-white border-black/10 shadow-xl'
        }`}>
        <div className={`p-6 border-b flex items-center justify-between ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
          <h3 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>إدارة التصنيفات</h3>
          <button onClick={onClose} className={`p-2 rounded-full transition-all ${isDarkMode ? 'hover:bg-white/5 text-gray-500' : 'hover:bg-black/5 text-gray-400'}`}>
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Add New Category */}
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="اسم التصنيف الجديد..."
                className={`flex-1 px-4 py-3 rounded-xl border text-sm outline-none transition-all font-bold ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                  }`}
              />
              <button
                type="button"
                onClick={handleAdd}
                className="bg-[#E53935] hover:bg-[#FF3B30] text-white p-3 rounded-xl shadow-lg transition-all"
              >
                <Plus size={20} />
              </button>
            </div>

            {/* Commission Type Selection */}
            {newCatName.trim() && (
              <div className="space-y-3 p-4 rounded-xl border" style={{ borderColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', backgroundColor: isDarkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
                <p className={`text-xs font-semibold ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>نوع توزيع العمولة</p>

                {/* Option 1: Barber Only */}
                <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all" style={{
                  borderColor: newCatCommissionType === 'barber_only' ? '#E53935' : (isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
                  backgroundColor: newCatCommissionType === 'barber_only' ? (isDarkMode ? 'rgba(229,57,53,0.1)' : 'rgba(229,57,53,0.05)') : 'transparent'
                }}>
                  <input
                    type="radio"
                    name="commission-type"
                    value="barber_only"
                    checked={newCatCommissionType === 'barber_only'}
                    onChange={(e) => setNewCatCommissionType(e.target.value as 'barber_only')}
                    className="mt-1 cursor-pointer"
                  />
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>النسبة كاملة للمصفف</p>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>يحصل المصفف على كامل نسبة العمولة لهذه الخدمات</p>
                  </div>
                </label>

                {/* Option 2: Barber and Assistant */}
                <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all" style={{
                  borderColor: newCatCommissionType === 'barber_and_assistant' ? '#E53935' : (isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
                  backgroundColor: newCatCommissionType === 'barber_and_assistant' ? (isDarkMode ? 'rgba(229,57,53,0.1)' : 'rgba(229,57,53,0.05)') : 'transparent'
                }}>
                  <input
                    type="radio"
                    name="commission-type"
                    value="barber_and_assistant"
                    checked={newCatCommissionType === 'barber_and_assistant'}
                    onChange={(e) => setNewCatCommissionType(e.target.value as 'barber_and_assistant')}
                    className="mt-1 cursor-pointer"
                  />
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>النسبة للمصفف والمساعد</p>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>يتم تقسيم نسبة العمولة بين المصفف والمساعد حسب النظام المعتمد</p>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Categories List */}
          <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
            {localCategories.map((cat) => (
              <div
                key={cat.id}
                className={`flex items-center gap-3 p-3 rounded-xl border group transition-all ${isDarkMode ? 'bg-white/5 border-white/5 hover:border-white/10' : 'bg-gray-50 border-black/5 hover:border-black/10'
                  }`}
              >
                <GripVertical size={16} className="text-gray-600 cursor-grab opacity-40" />

                <div className="flex-1">
                  {editingId === cat.id ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className={`w-full bg-transparent border-none outline-none text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                      />
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="radio"
                            name={`edit-commission-${cat.id}`}
                            checked={editingCommissionType === 'barber_only'}
                            onChange={() => setEditingCommissionType('barber_only')}
                          />
                          <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>النسبة للمصفف</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="radio"
                            name={`edit-commission-${cat.id}`}
                            checked={editingCommissionType === 'barber_and_assistant'}
                            onChange={() => setEditingCommissionType('barber_and_assistant')}
                          />
                          <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>النسبة للمصفف والمساعد</span>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{cat.name}</p>
                        {cat.id.toString().startsWith('temp-') && (
                          <span className="text-[8px] font-black px-1.5 py-0.5 bg-yellow-500/10 text-yellow-600 rounded-full uppercase tracking-tighter">قيد الانتظار</span>
                        )}
                      </div>
                      <p className={`text-xs ${isDarkMode ? 'text-gray-600' : 'text-gray-500'}`}>
                        {cat.commissionType === 'barber_and_assistant' ? 'النسبة للمصفف والمساعد' : 'النسبة للمصفف'}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {editingId === cat.id ? (
                    <button onClick={saveEdit} className="p-1.5 text-green-500 hover:bg-green-500/10 rounded-lg">
                      <Check size={16} />
                    </button>
                  ) : (
                    <button onClick={() => startEdit(cat)} className="p-1.5 text-blue-500 hover:bg-blue-500/10 rounded-lg">
                      <Edit2 size={16} />
                    </button>
                  )}
                  <button onClick={() => handleDelete(cat.id)} className="p-1.5 text-[#E53935] hover:bg-[#E53935]/10 rounded-lg">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={`p-6 border-t ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
          <button
            onClick={handleConfirmSave}
            disabled={isSaving}
            className={`w-full bg-[#E53935] text-white py-3 rounded-xl text-sm font-bold shadow-lg transition-all ${isSaving ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#FF3B30]'}`}
          >
            {isSaving ? 'جاري الحفظ...' : 'تأكيد وحفظ'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CategoryManagementModal;
