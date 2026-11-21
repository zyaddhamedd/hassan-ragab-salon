import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Plus, LayoutGrid, List, Settings } from 'lucide-react';
import ServiceCard from './ServiceCard.tsx';
import ServicesTable from './ServicesTable.tsx';
import ServiceModal from './ServiceModal.tsx';
import CategoryManagementModal from './CategoryManagementModal.tsx';
import { Service, Category } from '../types';

interface ServicesPageProps {
  isDarkMode: boolean;
  selectedBranch: string;
}

const ServicesPage: React.FC<ServicesPageProps> = ({ isDarkMode, selectedBranch }) => {
  // State management
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | "ALL">("ALL");
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);

  // CRITICAL: Working fetch logic - DO NOT CHANGE
  useEffect(() => {
    // console.log("🔥 FRONTEND: Starting fetch...");

    // CRITICAL: Use absolute URL specific to environment
    const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5001');
    const FETCH_URL = `${API_BASE_URL}/api/admin/services`;

    // console.log("🔥 FETCH URL:", FETCH_URL);

    setLoading(true);
    setError(null);

    const token = localStorage.getItem('admin_token');
    // console.log("🔥 FRONTEND: Token found:", token ? "YES" : "NO");

    fetch(FETCH_URL, {
      credentials: "include",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`
      }
    })
      .then(async res => {
        // console.log("🔥 FRONTEND: Response status:", res.status);
        // console.log("🔥 FRONTEND: Content-Type:", res.headers.get('content-type'));

        const text = await res.text();
        // console.log("🔥 RAW RESPONSE TEXT:", text.substring(0, 200));

        try {
          const data = JSON.parse(text);
          // console.log("🔥 FRONTEND: RAW SERVICES FROM API:", data);
          // console.log("🔥 FRONTEND: Total services:", data.length);

          // Transform backend data to frontend Service type
          const transformedServices: Service[] = data.map((s: any) => ({
            id: s.id?.toString() || '',
            name: s.name || 'Unnamed Service',
            price: s.price || 0,
            commission: s.barber_commission_percent,
            barber_commission_percent: s.barber_commission_percent,
            assistant_commission_percent: s.assistant_commission_percent,
            category: s.category_id?.toString() || 'uncategorized',
            category_name: s.category_name || 'غير مصنف',
            is_active: s.is_active !== false
          }));

          setServices(transformedServices);
        } catch (e) {
          console.error("❌ JSON PARSE FAILED - NOT JSON RESPONSE");
          console.error("Response was:", text.substring(0, 500));
          setError("Response is not JSON - likely auth redirect");
        }
      })
      .catch(err => {
        console.error("❌ FRONTEND: FETCH ERROR", err);
        setError("Fetch failed: " + err.message);
      })
      .finally(() => {
        // console.log("🔥 FRONTEND: Fetch complete");
        setLoading(false);
      });
  }, []);

  // 2. Fetch Categories
  const fetchCategories = async () => {
    try {
      // console.log("🔥 FETCHING CATEGORIES...");
      const token = localStorage.getItem('admin_token');
      const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5001');
      const response = await fetch(`${API_BASE_URL}/api/admin/service-categories`, {
        credentials: "include",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        }
      });
      const data = await response.json();
      // console.log("🔥 CATEGORIES RECEIVED:", data.length);

      const formatted = data
        .sort((a: any, b: any) => b.id - a.id) // NEWEST FIRST
        .map((cat: any) => ({
          id: cat.id.toString(),
          name: cat.name,
          order: 0
        }));
      setCategories(formatted);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  // 3. Sync Channel
  useEffect(() => {
    const syncChannel = new BroadcastChannel('salon_data_sync');
    syncChannel.onmessage = (event) => {
      if (event.data.type === 'REFETCH_DATA') {
        // console.log("📢 SYNC: Refetching categories...");
        fetchCategories();
      }
    };
    return () => syncChannel.close();
  }, []);

  // SAFE FILTERING LOGIC
  const filteredServices = useMemo(() => {
    let result = services;

    // 1. Branch filter (if requested in future, currently show all as per objectivity)
    // if (selectedBranch !== "All") { ... }

    // 2. Category filter
    if (selectedCategoryId !== "ALL") {
      result = result.filter(s => {
        // If category_id is null/missing -> ALWAYS show
        if (!s.category || s.category === 'uncategorized' || s.category === '0') return true;
        // Otherwise filter by strict ID
        return s.category === selectedCategoryId.toString();
      });
    }

    return result;
  }, [services, selectedCategoryId]);

  const handleAddService = () => {
    setEditingService(null);
    setIsModalOpen(true);
  };

  const handleEditService = (service: Service) => {
    setEditingService(service);
    setIsModalOpen(true);
  };

  const handleDeleteRequest = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه الخدمة؟')) return;

    try {
      // console.log(`🗑️ DELETING SERVICE: ${id}`);
      const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5001');
      const token = localStorage.getItem('admin_token');

      const response = await fetch(`${API_BASE}/api/admin/services/${id}`, {
        method: 'DELETE',
        credentials: "include",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'فشل حذف الخدمة');
      }

      // console.log('✅ SERVICE DELETED SUCCESSFULLY');

      // Update local state
      setServices(prev => prev.filter(s => s.id !== id));

      // Broadcast to other tabs (like Cashier)
      const syncChannel = new BroadcastChannel('salon_data_sync');
      syncChannel.postMessage({ type: 'REFETCH_DATA' });
      syncChannel.close();

    } catch (err: any) {
      console.error("❌ DELETE ERROR:", err);
      alert(err.message);
    }
  };

  // Logic to handle new service from modal
  const handleServiceAdded = (newServiceData: any) => {
    const transformed: Service = {
      id: newServiceData.id?.toString() || Date.now().toString(),
      name: newServiceData.name || 'Unnamed Service',
      price: newServiceData.price || 0,
      commission: newServiceData.barber_commission_percent ?? newServiceData.commission,
      barber_commission_percent: newServiceData.barber_commission_percent ?? newServiceData.commission,
      assistant_commission_percent: newServiceData.assistant_commission_percent,
      category: newServiceData.category_id?.toString() || 'uncategorized',
      category_name: newServiceData.category_name || 'غير مصنف',
      is_active: newServiceData.is_active !== false
    };

    setServices(prev => {
      const exists = prev.some(s => s.id === transformed.id);
      if (exists) {
        return prev.map(s => s.id === transformed.id ? transformed : s);
      }
      return [transformed, ...prev];
    });
  };

  return (
    <div className="admin-page-shell space-y-8 animate-fade-in-up">
      {/* Action Bar */}
      <div className="flex flex-col lg:flex-row justify-end items-start lg:items-end gap-6">
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <button
            onClick={handleAddService}
            className="flex-1 sm:flex-none bg-[#E53935] hover:bg-[#FF3B30] text-white px-6 py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-xl shadow-red-900/20 flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <Plus size={16} />
            إضافة خدمة
          </button>
        </div>
      </div>

      {/* Categories Bar & View Toolbar */}
      <div className="flex flex-col gap-6">
        {/* Category Tabs */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className={`flex flex-1 p-1 rounded-2xl border overflow-x-auto w-full scrollbar-hide ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-gray-50 border-black/5'}`}>
            <button
              onClick={() => setSelectedCategoryId("ALL")}
              className={`px-6 py-3 rounded-xl whitespace-nowrap text-[10px] font-bold uppercase tracking-widest transition-all ${selectedCategoryId === "ALL"
                ? (isDarkMode ? 'bg-white/10 text-[#E6D690]' : 'bg-white shadow-sm text-gray-900')
                : 'text-gray-500 hover:text-gray-400'
                }`}
            >
              جميع الخدمات
            </button>
            {categories.map(cat => {
              const catId = Number(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(catId)}
                  className={`px-6 py-3 rounded-xl whitespace-nowrap text-[10px] font-bold uppercase tracking-widest transition-all ${selectedCategoryId === catId
                    ? (isDarkMode ? 'bg-white/10 text-[#E6D690]' : 'bg-white shadow-sm text-gray-900')
                    : 'text-gray-500 hover:text-gray-400'
                    }`}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className={`p-3 rounded-2xl border transition-all ${isDarkMode ? 'bg-white/5 border-white/5 text-gray-500 hover:text-[#E6D690]' : 'bg-white border-black/5 text-gray-400 hover:text-[#E53935]'}`}
            title="إدارة التصنيفات"
          >
            <Settings size={20} />
          </button>
        </div>

        {/* View Toggle */}
        <div className="flex justify-end items-center">
          <div className={`flex p-1 rounded-2xl border ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-gray-50 border-black/5'}`}>
            <button
              onClick={() => setViewMode('cards')}
              className={`p-2 px-4 rounded-xl flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest transition-all ${viewMode === 'cards' ? (isDarkMode ? 'bg-white/5 text-white' : 'bg-white shadow-sm text-gray-900') : 'text-gray-500 hover:text-gray-400'
                }`}
            >
              <LayoutGrid size={14} />
              بطاقات
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 px-4 rounded-xl flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest transition-all ${viewMode === 'table' ? (isDarkMode ? 'bg-white/5 text-white' : 'bg-white shadow-sm text-gray-900') : 'text-gray-500 hover:text-gray-400'
                }`}
            >
              <List size={14} />
              جدول
            </button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {
        loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 animate-pulse">
            <RefreshCw size={40} className="text-[#E6D690] animate-spin" />
            <p className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              جاري تحميل الخدمات...
            </p>
          </div>
        )
      }

      {/* Error State */}
      {
        error && (
          <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl">
            <span className="text-red-500">❌ {error}</span>
          </div>
        )
      }

      {/* Services Display - SAFE RENDERING */}
      {
        !loading && !error && (
          <>
            {filteredServices.length > 0 ? (
              viewMode === 'cards' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {filteredServices.map(service => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      isDarkMode={isDarkMode}
                      onEdit={handleEditService}
                      onDelete={handleDeleteRequest}
                    />
                  ))}
                </div>
              ) : (
                <ServicesTable
                  services={filteredServices}
                  isDarkMode={isDarkMode}
                  onEdit={handleEditService}
                  onDelete={handleDeleteRequest}
                />
              )
            ) : (
              <div className={`py-24 text-center rounded-[3rem] border-2 border-dashed flex flex-col items-center justify-center gap-4 ${isDarkMode ? 'border-white/5 bg-white/[0.01]' : 'border-gray-100 bg-gray-50/50'
                }`}>
                <h3 className={`text-lg font-bold mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  لا توجد خدمات في هذا التصنيف
                </h3>
                <button
                  onClick={() => setSelectedCategoryId("ALL")}
                  className="text-[10px] font-bold text-[#E53935] uppercase tracking-widest"
                >
                  عرض كل الخدمات
                </button>
              </div>
            )}
          </>
        )
      }

      {/* Service Modal */}
      {
        isModalOpen && (
          <ServiceModal
            isDarkMode={isDarkMode}
            service={editingService}
            categories={categories}
            selectedBranch={selectedBranch}
            initialCategoryId={selectedCategoryId === "ALL" ? "All" : selectedCategoryId.toString()}
            onClose={() => setIsModalOpen(false)}
            onRefresh={(newService) => {
              if (newService) handleServiceAdded(newService);
            }}
          />
        )
      }

      {/* Category Management Modal */}
      {
        isCategoryModalOpen && (
          <CategoryManagementModal
            isDarkMode={isDarkMode}
            onClose={() => setIsCategoryModalOpen(false)}
            onRefresh={fetchCategories}
          />
        )
      }
    </div>
  );
};

export default ServicesPage;
