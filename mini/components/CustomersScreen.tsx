
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Search, Phone, Scissors, Star, UserCircle, Edit3, X, Camera, Plus, CheckCircle2, Eye, ChevronLeft, ChevronRight, Trash2, Wallet } from 'lucide-react';
import type { Customer, StaffMember } from '../App';
import { apiClient, BACKEND_URL } from '../src/api/client';

interface CustomersScreenProps {
  staff: StaffMember[];
  onEdit: (id: string, data: FormData) => Promise<Customer>;
  onAdd: (formData: FormData) => Promise<Customer>;
  onDelete: (id: string) => Promise<void>;
}

interface CustomersResponse {
  items: MiniCustomerApiRecord[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
}

interface MiniCustomerApiRecord {
  id: number | string;
  name: string;
  phone: string;
  images?: string[];
  visits_count?: number;
  visitCount?: number;
  last_barber_name?: string | null;
  lastBarber?: string;
  created_at?: string | null;
  last_visit_at?: string | null;
  deposit_balance?: number;
  depositBalance?: number;
}

const PAGE_SIZE = 20;

const mapCustomerImageUrl = (imagePath: string) => {
  if (!imagePath) {
    return imagePath;
  }

  if (/^https?:\/\//i.test(imagePath)) {
    return imagePath;
  }

  const normalizedPath = imagePath.startsWith('/') ? imagePath : `/uploads/${imagePath}`;
  return `${BACKEND_URL}${normalizedPath}`;
};

const mapCustomerFromApi = (customer: MiniCustomerApiRecord, fallback?: Partial<Customer>): Customer => ({
  id: String(customer.id),
  name: customer.name,
  phone: customer.phone,
  images: (customer.images || []).map(mapCustomerImageUrl),
  visitCount: customer.visits_count ?? customer.visitCount ?? fallback?.visitCount ?? 0,
  lastBarber: customer.last_barber_name ?? customer.lastBarber ?? fallback?.lastBarber ?? '',
  lastVisitDate: customer.last_visit_at
    ? new Date(customer.last_visit_at).getTime()
    : customer.created_at
      ? new Date(customer.created_at).getTime()
      : fallback?.lastVisitDate ?? Date.now(),
  depositBalance: customer.deposit_balance ?? customer.depositBalance ?? fallback?.depositBalance ?? 0,
});

const mergeUniqueCustomers = (current: Customer[], incoming: Customer[]) => {
  const existingIds = new Set(current.map(customer => customer.id));
  const uniqueIncoming = incoming.filter(customer => !existingIds.has(customer.id));
  return [...current, ...uniqueIncoming];
};

const CustomersScreen: React.FC<CustomersScreenProps> = React.memo(({ staff, onEdit, onAdd, onDelete }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editFiles, setEditFiles] = useState<File[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasMore: false,
  });
  const requestSeqRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);

  const handleViewCustomer = (customer: Customer) => {
    setViewingCustomer(customer);
    setActiveImageIndex(0);
  };

  // Update the button onClick to use the new handler
  // ... (context for replacement locator)


  // New Customer State
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    phone: '',
    lastBarber: ''
  });

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string>('');

  const barbers = useMemo(() => staff.filter(s => s.role === 'حلاق'), [staff]);

  const fetchCustomers = useCallback(async (page: number, query: string, mode: 'replace' | 'append' = 'replace') => {
    const requestSeq = ++requestSeqRef.current;
    const trimmedQuery = query.trim();

    setLoadError('');
    if (mode === 'append') {
      setIsLoadingMore(true);
    } else if (hasLoadedOnceRef.current) {
      setIsRefreshing(true);
    } else {
      setIsInitialLoading(true);
    }

    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(PAGE_SIZE),
      });
      if (trimmedQuery) {
        params.set('q', trimmedQuery);
      }

      const response = await apiClient.get(`/customers?${params.toString()}`) as CustomersResponse;
      if (requestSeq !== requestSeqRef.current) return;

      const nextItems = Array.isArray(response.items)
        ? response.items.map((customer) => mapCustomerFromApi(customer))
        : [];
      setCustomers(prev => mode === 'append' ? mergeUniqueCustomers(prev, nextItems) : nextItems);
      setPagination({
        page: response.page ?? page,
        perPage: response.per_page ?? PAGE_SIZE,
        total: response.total ?? 0,
        totalPages: response.total_pages ?? 0,
        hasMore: Boolean(response.has_more),
      });
      hasLoadedOnceRef.current = true;
    } catch (fetchError) {
      if (requestSeq !== requestSeqRef.current) return;
      console.error('Failed to fetch customers:', fetchError);
      setLoadError('تعذر تحميل العملاء الآن. حاول مرة أخرى.');
      if (mode !== 'append') {
        setCustomers([]);
        setPagination({
          page: 1,
          perPage: PAGE_SIZE,
          total: 0,
          totalPages: 0,
          hasMore: false,
        });
      }
    } finally {
      if (requestSeq !== requestSeqRef.current) return;
      setIsInitialLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    void fetchCustomers(1, debouncedSearchTerm, 'replace');
  }, [debouncedSearchTerm, fetchCustomers]);

  const getBadge = (count: number) => {
    if (count >= 15) return { label: 'عميل مميز', color: 'text-[#E6D690] border-[#E6D690]/20 bg-[#E6D690]/5', icon: <Star size={10} className="fill-current" /> };
    if (count >= 5) return { label: 'عميل متكرر', color: 'text-amber-400 border-amber-400/20 bg-amber-400/5', icon: null };
    return { label: 'عميل جديد', color: 'text-white border-white/10 bg-white/5', icon: null };
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.name || !newCustomer.phone) return;

    setError('');

    try {
      const formData = new FormData();
      formData.append('name', newCustomer.name);
      formData.append('phone', newCustomer.phone);
      if (newCustomer.lastBarber) {
        formData.append('last_barber_id', newCustomer.lastBarber);
      }

      // Append all selected images
      selectedFiles.forEach(file => {
        formData.append('images[]', file);
      });

      await onAdd(formData);
      await fetchCustomers(1, '', 'replace');

      // Success - close modal and reset
      setIsAddModalOpen(false);
      setNewCustomer({ name: '', phone: '', lastBarber: '' });
      setSelectedFiles([]);
      setSearchTerm('');
    } catch (err: any) {
      setError(err.message || 'فشل في إضافة العميل');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;

    try {
      const formData = new FormData();
      formData.append('name', editingCustomer.name);
      formData.append('phone', editingCustomer.phone);
      formData.append('last_barber_id', editingCustomer.lastBarber ? staff.find(s => s.name === editingCustomer.lastBarber && s.role === 'حلاق')?.id.toString() || '' : '');

      // Append new files
      editFiles.forEach(file => {
        formData.append('images[]', file);
      });

      await onEdit(editingCustomer.id, formData);
      await fetchCustomers(1, debouncedSearchTerm, 'replace');
      setEditingCustomer(null);
      setEditFiles([]);
    } catch (error) {
      console.error("Failed to update customer:", error);
      alert("فشل تحديث بيانات العميل");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleLoadMore = async () => {
    if (isLoadingMore || !pagination.hasMore) return;
    await fetchCustomers(pagination.page + 1, debouncedSearchTerm, 'append');
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا العميل؟ لا يمكن التراجع عن هذا الإجراء.')) {
      return;
    }

    try {
      await onDelete(id);
      if (viewingCustomer?.id === id) {
        setViewingCustomer(null);
      }
      if (editingCustomer?.id === id) {
        setEditingCustomer(null);
      }
      await fetchCustomers(1, debouncedSearchTerm, 'replace');
    } catch (deleteError) {
      console.error("Failed to delete customer:", deleteError);
    }
  };

  return (
    <div className="mini-screen transition-colors duration-500 font-['Cairo'] bg-[#121212] text-[#F5F5F5]" dir="rtl">
      {/* Header */}
      <header className="mini-page-header border-b border-white/5 bg-[#121212]/90 space-y-4 lg:space-y-6 z-40">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="w-1.5 h-8 rounded-full shadow-[0_0_15px_#E6D690] bg-[#E6D690]"></div>
            <h1 className="text-2xl font-black tracking-tight">قائمة العملاء</h1>
            {isRefreshing && (
              <div className="w-4 h-4 border border-white/15 border-t-[#E6D690] rounded-full animate-spin" />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4">
            <div className="hidden sm:flex px-5 py-2 rounded-xl border bg-[#1E1E1E] border-white/5 text-[11px] font-bold text-[#BDBDBD]">
              إجمالي المسجلين: <span className="text-[#E6D690] mr-2">{pagination.total}</span>
            </div>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-6 py-2.5 bg-[#E6D690] text-[#121212] rounded-xl text-xs font-black hover:bg-[#ffed9e] transition-all active:scale-95"
            >
              <Plus size={16} />
              إضافة عميل
            </button>
          </div>
        </div>

        <div className="relative group max-w-2xl">
          <input
            type="text"
            placeholder="ابحث بالاسم أو الرقم..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1E1E1E] border border-white/5 rounded-2xl py-4 pr-14 pl-6 text-sm outline-none focus:border-[#E6D690]/40 transition-all placeholder:text-[#BDBDBD]/30"
          />
          <Search size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-[#BDBDBD] opacity-30 group-focus-within:opacity-60 transition-opacity" />
        </div>
      </header>

      <div className="mini-scroll-y custom-scrollbar mini-page-body">
        {isInitialLoading ? (
          <div className="flex flex-col items-center justify-center min-h-[18rem] gap-4 text-center">
            <div className="w-10 h-10 border-2 border-white/10 border-t-[#E6D690] rounded-full animate-spin" />
            <p className="text-sm text-white/45">جاري تحميل أول دفعة من العملاء...</p>
          </div>
        ) : loadError ? (
          <div className="max-w-xl mx-auto rounded-[2rem] border border-[#E53935]/20 bg-[#E53935]/5 p-8 text-center space-y-4">
            <p className="text-sm text-red-300">{loadError}</p>
            <button
              onClick={() => void fetchCustomers(1, debouncedSearchTerm, 'replace')}
              className="px-6 py-3 rounded-2xl bg-[#E6D690] text-[#121212] text-xs font-black hover:bg-[#ffed9e] transition-all"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="w-full max-w-none grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {customers.map((customer) => {
                const badge = getBadge(customer.visitCount);
                const customerImage = customer.images && customer.images.length > 0 ? customer.images[0] : null;

                return (
                  <button
                    key={customer.id}
                    onClick={() => handleViewCustomer(customer)}
                    className="group relative flex h-full flex-col gap-5 overflow-hidden rounded-[2rem] border bg-[#1E1E1E] p-6 text-right outline-none transition-all duration-500 hover:border-[#E6D690]/40 focus:ring-1 focus:ring-[#E6D690]/20 border-white/5"
                  >
                    <div className="flex items-center justify-between">
                      <div className={`px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 ${badge.color}`}>
                        {badge.icon}
                        {badge.label}
                      </div>
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCustomer({ ...customer });
                          }}
                          className="p-1.5 rounded-full bg-white/5 hover:bg-[#E6D690] hover:text-[#121212] transition-colors text-[#BDBDBD]"
                          title="تعديل"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteCustomer(customer.id);
                          }}
                          className="p-1.5 rounded-full bg-white/5 hover:bg-[#E53935] hover:text-white transition-colors text-[#BDBDBD]"
                          title="حذف"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-2xl bg-[#121212] border border-white/5 flex items-center justify-center overflow-hidden shrink-0 transition-transform group-hover:scale-105">
                        {customerImage ? (
                          <img src={customerImage} alt={customer.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center justify-center opacity-20">
                            <UserCircle size={32} className="text-[#BDBDBD]" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 overflow-hidden">
                        <h3 className="text-md truncate font-black text-white transition-colors group-hover:text-[#E6D690]">{customer.name}</h3>
                        <div className="flex items-center gap-2 mt-1 opacity-40 text-[#BDBDBD] text-xs">
                          <Phone size={10} />
                          <span className="tracking-widest">{customer.phone}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-5 border-t border-white/5">
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black opacity-20 uppercase tracking-widest">عدد الزيارات</span>
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-black text-[#E6D690]">{customer.visitCount}</span>
                          {customer.visitCount >= 10 && <span className="text-xs">🔥</span>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 text-left">
                        <span className="text-[9px] font-black opacity-20 uppercase tracking-widest">آخر حلاق</span>
                        <div className="flex items-center justify-end gap-1.5 text-xs font-bold text-[#BDBDBD]">
                          <Scissors size={10} className="text-[#E6D690]" />
                          <span className="truncate max-w-[80px]">{customer.lastBarber || 'لم يحدد بعد'}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {customers.length === 0 && (
              <div className="text-center py-16 text-sm text-white/35">
                {debouncedSearchTerm ? 'لا توجد نتائج مطابقة لبحثك.' : 'لا يوجد عملاء لعرضهم الآن.'}
              </div>
            )}

            {(pagination.hasMore || isLoadingMore) && (
              <div className="flex flex-col items-center gap-3 pb-6">
                <button
                  onClick={() => void handleLoadMore()}
                  disabled={isLoadingMore}
                  className="px-8 py-3 rounded-2xl border border-[#E6D690]/25 bg-[#1E1E1E] text-[#E6D690] text-xs font-black hover:bg-[#E6D690]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isLoadingMore ? 'جاري تحميل المزيد...' : 'تحميل المزيد'}
                </button>
                {isLoadingMore && <div className="w-5 h-5 border border-white/15 border-t-[#E6D690] rounded-full animate-spin" />}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Customer Modal */}
      {isAddModalOpen && (
        <div className="mini-modal-overlay animate-in fade-in duration-300">
          <div className="mini-modal-panel bg-[#1E1E1E] border border-white/10 rounded-[2.5rem] w-full max-w-md p-8 lg:p-10 relative shadow-2xl overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#E6D690]/5 blur-3xl rounded-full"></div>
            <button onClick={() => setIsAddModalOpen(false)} className="absolute top-8 left-8 text-[#BDBDBD] hover:text-[#E53935] transition-colors"><X size={20} /></button>
            <h2 className="text-xl font-black mb-8 flex items-center gap-3">
              <Plus size={20} className="text-[#E6D690]" />
              إضافة عميل جديد
            </h2>
            <form onSubmit={handleAddSubmit} className="space-y-5 relative z-10">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">اسم العميل (إجباري)</label>
                <input
                  required
                  value={newCustomer.name}
                  onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  className="w-full bg-[#121212] border border-white/5 rounded-xl py-4 px-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">رقم الجوال (إجباري)</label>
                <input
                  required
                  type="tel"
                  value={newCustomer.phone}
                  onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  className="w-full bg-[#121212] border border-white/5 rounded-xl py-4 px-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm tracking-widest"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">صور العميل (اختياري)</label>
                <div className="relative">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleFileChange}
                    className="w-full bg-[#121212] border border-white/5 rounded-xl py-4 px-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#E6D690] file:text-[#121212] hover:file:bg-[#ffed9e]"
                  />
                  {selectedFiles.length > 0 && (
                    <p className="text-xs text-[#E6D690] mt-2">{selectedFiles.length} صورة محددة</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">آخر حلاق (اختياري)</label>
                <select
                  value={newCustomer.lastBarber}
                  onChange={e => setNewCustomer({ ...newCustomer, lastBarber: e.target.value })}
                  className="w-full bg-[#121212] border border-white/5 rounded-xl py-4 px-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm appearance-none"
                >
                  <option value="">-- بدون حلاق --</option>
                  {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
                  {error}
                </div>
              )}

              <button type="submit" className="w-full py-5 bg-[#E6D690] text-[#121212] font-black rounded-2xl text-sm transition-all hover:bg-[#ffed9e] active:scale-95 shadow-lg shadow-[#E6D690]/10 mt-4">
                حفظ العميل
              </button>
            </form>
          </div>
        </div>
      )}

      {/* View Customer Modal (Read-Only) */}
      {viewingCustomer && !editingCustomer && (
        <div className="mini-modal-overlay animate-in fade-in duration-300">
          <div className="mini-modal-panel bg-[#1E1E1E] border border-white/10 rounded-[2.5rem] w-full max-w-md p-8 lg:p-10 relative shadow-2xl overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-[#E6D690]"></div>
            <div className="absolute top-8 left-8 flex items-center gap-4 z-10">

              <button onClick={() => setViewingCustomer(null)} className="text-[#BDBDBD] hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-col items-center mb-8">
              {/* Image Gallery */}
              {viewingCustomer.images && viewingCustomer.images.length > 0 ? (
                <div className="w-full mb-6 select-none">
                  {/* Main Image Stage */}
                  <div className="relative w-full aspect-[4/3] rounded-3xl bg-[#000] border border-white/10 overflow-hidden group">
                    <img
                      src={viewingCustomer.images[activeImageIndex]}
                      alt={viewingCustomer.name}
                      className="w-full h-full object-contain"
                    />

                    {/* Navigation Arrows */}
                    {viewingCustomer.images.length > 1 && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveImageIndex(prev => prev === 0 ? viewingCustomer.images.length - 1 : prev - 1);
                          }}
                          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#E6D690] hover:text-black hover:border-[#E6D690]"
                        >
                          <ChevronLeft size={20} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveImageIndex(prev => prev === viewingCustomer.images.length - 1 ? 0 : prev + 1);
                          }}
                          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#E6D690] hover:text-black hover:border-[#E6D690]"
                        >
                          <ChevronRight size={20} />
                        </button>

                        {/* Image Counter */}
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-[10px] font-black tracking-widest text-white/80">
                          {activeImageIndex + 1} / {viewingCustomer.images.length}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Thumbnails Strip */}
                  {viewingCustomer.images.length > 1 && (
                    <div className="flex gap-3 mt-4 overflow-x-auto pb-2 custom-scrollbar px-1">
                      {viewingCustomer.images.map((img, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveImageIndex(idx)}
                          className={`relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 transition-all duration-300 ${activeImageIndex === idx
                            ? 'ring-2 ring-[#E6D690] ring-offset-2 ring-offset-[#1E1E1E] opacity-100 scale-105'
                            : 'opacity-40 hover:opacity-100 hover:scale-105'
                            }`}
                        >
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-32 h-32 rounded-[2rem] bg-[#121212] border border-white/5 flex items-center justify-center overflow-hidden mb-6 mx-auto">
                  <UserCircle size={64} className="text-[#BDBDBD] opacity-20" />
                </div>
              )}

              <h2 className="text-xl font-black">{viewingCustomer.name}</h2>
              <div className="flex items-center gap-2 mt-2">
                <div className={`px-4 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 ${getBadge(viewingCustomer.visitCount).color}`}>
                  {getBadge(viewingCustomer.visitCount).icon}
                  {getBadge(viewingCustomer.visitCount).label}
                </div>
                <div className="px-3 py-1 bg-white/5 border border-white/5 rounded-full text-[9px] font-black opacity-40">
                  {viewingCustomer.visitCount} زيارة
                </div>
              </div>
            </div>

            {/* Read-Only Info */}
            <div className="space-y-4 mb-6">
              <div className="bg-[#121212] border border-white/5 rounded-xl p-4">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-2">رقم الهاتف</div>
                <div className="flex items-center gap-2 text-sm">
                  <Phone size={14} className="text-[#E6D690]" />
                  <span className="tracking-widest">{viewingCustomer.phone}</span>
                </div>
              </div>
              <div className="bg-[#121212] border border-white/5 rounded-xl p-4">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-2">آخر حلاق</div>
                <div className="flex items-center gap-2 text-sm">
                  <Scissors size={14} className="text-[#E6D690]" />
                  <span>{viewingCustomer.lastBarber || 'لم يحدد بعد'}</span>
                </div>
              </div>
              <div className="bg-[#121212] border border-[#E6D690]/15 rounded-xl p-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#E6D690]/70 mb-2">رصيد العربون لهذا الفرع</div>
                <div className="flex items-center gap-2 text-sm">
                  <Wallet size={14} className="text-[#E6D690]" />
                  <span className="font-black text-[#E6D690]">
                    {(viewingCustomer.depositBalance || 0).toLocaleString('en-US')} EGP
                  </span>
                </div>
              </div>
            </div>

            {/* Edit Button */}

          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <div className="mini-modal-overlay animate-in fade-in duration-300">
          <div className="mini-modal-panel bg-[#1E1E1E] border border-white/10 rounded-[2.5rem] w-full max-w-md p-8 lg:p-10 relative shadow-2xl overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-amber-500"></div>
            <button onClick={() => setEditingCustomer(null)} className="absolute top-8 left-8 text-[#BDBDBD] hover:text-[#E53935] transition-colors"><X size={20} /></button>

            <h2 className="text-xl font-black mb-8 flex items-center gap-3">
              <Edit3 size={20} className="text-amber-500" />
              تعديل بيانات العميل
            </h2>

            <form onSubmit={handleEditSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">اسم العميل</label>
                <input
                  value={editingCustomer.name}
                  onChange={e => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                  className="w-full bg-[#121212] border border-white/5 rounded-xl py-4 px-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">رقم الهاتف</label>
                <input
                  value={editingCustomer.phone}
                  onChange={e => setEditingCustomer({ ...editingCustomer, phone: e.target.value })}
                  className="w-full bg-[#121212] border border-white/5 rounded-xl py-4 px-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm tracking-widest"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">صور العميل (اختياري)</label>
                <div className="relative">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={e => {
                      if (e.target.files) {
                        setEditFiles(Array.from(e.target.files));
                      }
                    }}
                    className="w-full bg-[#121212] border border-white/5 rounded-xl py-4 px-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#E6D690] file:text-[#121212] hover:file:bg-[#ffed9e]"
                  />
                  {editFiles.length > 0 && (
                    <p className="text-xs text-[#E6D690] mt-2">{editFiles.length} صورة محددة</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">تعديل آخر حلاق (اختياري)</label>
                <select
                  value={editingCustomer.lastBarber || ''}
                  onChange={e => setEditingCustomer({ ...editingCustomer, lastBarber: e.target.value })}
                  className="w-full bg-[#121212] border border-white/5 rounded-xl py-4 px-6 outline-none focus:border-[#E6D690]/40 transition-all text-sm appearance-none"
                >
                  <option value="">-- بدون حلاق --</option>
                  {barbers.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                </select>
              </div>

              <button type="submit" className="w-full py-5 bg-[#E6D690] text-[#121212] font-black rounded-2xl text-sm transition-all hover:bg-[#ffed9e] active:scale-95 shadow-lg shadow-[#E6D690]/10 mt-6 flex items-center justify-center gap-3">
                <CheckCircle2 size={18} />
                حفظ التغييرات
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
});

export default CustomersScreen;
