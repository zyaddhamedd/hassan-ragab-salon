
import React, { useState, useEffect, useCallback } from 'react';
import { getTodayISO, getCairoNow, formatDate } from './src/utils/dateFormatter';
import LoginScreen from './components/LoginScreen';
import CashierScreen from './components/CashierScreen';
import { BookingHandoffRequest } from './src/types/models';
import CustomersScreen from './components/CustomersScreen';
import BarbersScreen from './components/BarbersScreen';
import AppointmentsScreen from './components/AppointmentsScreen';
import ExpensesScreen from './components/ExpensesScreen';
import StorageScreen from './components/StorageScreen';
import AttendanceScreen from './components/AttendanceScreen';
import QueueScreen from './components/QueueScreen';
import WaitingScreen from './components/WaitingScreen';
import Sidebar from './components/Sidebar';
import PagePlaceholder from './components/PagePlaceholder';
import MiniTreasuryPage from './pages/MiniTreasuryPage';
import InventoryOnlyApp from './components/InventoryOnlyApp';

export type PageType = 'الانتظار' | 'الكاشير' | 'الحضور والانصراف' | 'العملاء' | 'الحلاقين' | 'المواعيد القادمة' | 'المصروفات' | 'المخزن' | 'الخزينة';

export interface Cashier {
  id: number;
  name: string;
  email: string;
  branch_id: number;
  branch_name: string;
  branch_settings: {
    allow_discounts: boolean;
  };
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  image?: string;
  images?: string[];  // Array of image URLs
  visitCount: number;
  lastBarber?: string;
  lastVisitDate: number;
  depositBalance: number;
}

export interface StaffMember {
  id: number;
  name: string;
  role: 'حلاق' | 'مساعد';
  isPresent: boolean;
  avatar: string;
  phone?: string;
}

export interface Appointment {
  id: string;
  customerId?: number;
  barberId?: number | null;
  serviceId?: number | null;
  rawStatus?: 'scheduled' | 'completed' | 'cancelled';
  customerName: string;
  phone: string;
  service: string;
  barberName: string;
  time: string;
  date: string;
  status: 'قادم' | 'تم';
  deposit?: number;
}

export type AppointmentDepositPaymentMethod = 'CASH' | 'VISA' | 'INSTAPAY';

export interface AppointmentDepositTransactionReceipt {
  id: number;
  receipt_number: string;
  appointment_id: number;
  customer_id: number;
  customer_name?: string;
  customer_phone?: string;
  branch_id: number;
  branch_name?: string;
  business_day_id: number;
  cashier_id: number;
  cashier_name?: string;
  collected_by_user_id: number;
  amount: number;
  payment_method: AppointmentDepositPaymentMethod;
  payment_method_label: string;
  transaction_type: string;
  created_at: string;
  appointment_date?: string;
  appointment_time?: string;
  service_name?: string;
  barber_name?: string;
}

export interface AppointmentFormData extends Omit<Appointment, 'id' | 'status'> {
  depositPaymentMethod?: AppointmentDepositPaymentMethod;
}

export interface AppointmentCreateResult {
  appointment: Appointment;
  depositTransaction?: AppointmentDepositTransactionReceipt;
}

export interface Expense {
  id: string;
  type: string; // Category name (display)
  categoryId?: number; // Category ID for backend (optional for existing expenses)
  amount: number;
  notes?: string;
  date: string;
  time: string;
  cashierName: string;
}

export interface AdminSettings {
  discountEnabled: boolean;
  discountType: 'percentage' | 'fixed';
}

// Dynamic settings getter wrapped in a stable reference later if necessary, currently pure function
const getEffectiveSettings = (cashier: Cashier | null): AdminSettings => ({
  discountEnabled: cashier?.branch_settings?.allow_discounts ?? true,
  discountType: 'percentage', // Kept as default for UI behavior
});

import {
  apiClient,
  BACKEND_URL,
  MiniDeviceContext,
  getStoredDeviceContext,
  normalizeMiniDeviceContext,
  setStoredDeviceContext,
} from './src/api/client';


// ... imports

// Remove INITIAL_STAFF


// Mock appointments removed - now using backend API
// Mock expenses removed - now using backend API

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [cashier, setCashier] = useState<Cashier | null>(null);
  const [deviceContext, setDeviceContext] = useState<MiniDeviceContext | null>(getStoredDeviceContext());
  const [activePage, setActivePage] = useState<PageType>('الكاشير');
  const [bookingHandoff, setBookingHandoff] = useState<BookingHandoffRequest | null>(null);
  const [handoffFeedback, setHandoffFeedback] = useState<{id: number; message: string} | null>(null);
  const handoffPendingRef = React.useRef(false);
  const requestBookingHandoff = useCallback((appointmentId: number) => {
    if (handoffPendingRef.current) return;
    handoffPendingRef.current = true;
    setHandoffFeedback(null);
    setBookingHandoff({appointmentId, requestId: Date.now()});
  }, []);
  const completeBookingHandoff = useCallback((appointmentId: number, error?: string) => {
    handoffPendingRef.current = false;
    setBookingHandoff(null);
    if (error) setHandoffFeedback({id: appointmentId, message: error});
    else { setHandoffFeedback(null); setActivePage('الكاشير'); }
  }, []);

  const [isBootstrapping, setIsBootstrapping] = useState(true); // true until token check completes
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [isMiniSidebarOpen, setIsMiniSidebarOpen] = useState(false);

  const clearingMiniSessionRef = React.useRef(false);
  const clearMiniSession = useCallback(() => {
    if (clearingMiniSessionRef.current) return;
    clearingMiniSessionRef.current = true;
    try {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('mini_booking_handoff:')) sessionStorage.removeItem(key);
      }
      localStorage.removeItem('mini_cashier');
      localStorage.removeItem('mini_token');
      localStorage.removeItem('mini_refresh_token');
      setStoredDeviceContext(null);
      setCashier(null);
      setDeviceContext(null);
      setIsLoggedIn(false);
      setActivePage('الكاشير');
      setBookingHandoff(null); setHandoffFeedback(null); handoffPendingRef.current = false;
      setIsMiniSidebarOpen(false);
    } finally {
      clearingMiniSessionRef.current = false;
    }
  }, []);

  useEffect(() => {
    setIsMiniSidebarOpen(false);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const syncShellHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      root.style.setProperty('--mini-shell-height', `${viewportHeight}px`);
    };

    syncShellHeight();
    window.addEventListener('resize', syncShellHeight);
    window.visualViewport?.addEventListener('resize', syncShellHeight);

    return () => {
      window.removeEventListener('resize', syncShellHeight);
      window.visualViewport?.removeEventListener('resize', syncShellHeight);
      root.style.removeProperty('--mini-shell-height');
    };
  }, []);

  useEffect(() => {
    if (!isMiniSidebarOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMiniSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isMiniSidebarOpen]);

  // ─── Auth Bootstrap ────────────────────────────────────────────────────────
  // Runs ONCE on mount. Checks localStorage for a stored token and validates
  // it silently. Restores session if valid, shows login if expired/missing.
  useEffect(() => {
    const bootstrap = async () => {
      const token = localStorage.getItem('mini_token');
      const savedCashier = localStorage.getItem('mini_cashier');

      if (!token) {
        // Nothing stored — proceed to login screen
        setIsBootstrapping(false);
        return;
      }

      try {
        // Silent validation using our global client which handles headers/formatting
        const data = await apiClient.get('/auth/me');

        if (data) {
          const resolvedDeviceContext = normalizeMiniDeviceContext(data.device_context);
          const cachedCashier = savedCashier ? JSON.parse(savedCashier) : null;
          const serverCashier: Cashier = {
            id: data.id,
            name: data.name,
            email: data.email ?? cachedCashier?.email ?? '',
            branch_id: data.branch_id,
            branch_name: data.branch_name,
            branch_settings: {
              allow_discounts: data.branch_settings?.allow_discounts ?? true,
            },
          };

          if (!resolvedDeviceContext) {
            clearMiniSession();
            setSessionError('تعذر التحقق من صلاحية هذا الجهاز. سجّل الدخول مرة أخرى.');
            return;
          }

          localStorage.setItem('mini_cashier', JSON.stringify(serverCashier));
          setCashier(serverCashier);
          setStoredDeviceContext(resolvedDeviceContext);
          setDeviceContext(resolvedDeviceContext);
          setSessionError(null);
          setIsLoggedIn(true);
        }
      } catch (error: any) {
        console.warn('[AUTH] Bootstrap silent validation failed:', error);
        // apiClient throws on non-OK responses, clear storage and go to login
        clearMiniSession();
        if (
          error?.code === 'DEVICE_PROOF_KEY_MISSING' ||
          error?.code === 'DEVICE_PROOF_KEY_MISMATCH' ||
          error?.code === 'DEVICE_PROOF_STORAGE_UNAVAILABLE' ||
          error?.code === 'DEVICE_PROOF_REPAIR_REQUIRED'
        ) {
          setSessionError('مفتاح الجهاز الآمن غير موجود أو لا يطابق التسجيل. اطلب من الإدارة إعادة ربط الجهاز.');
        }
      } finally {
        setIsBootstrapping(false);
      }
    };

    bootstrap();
  }, [clearMiniSession]); // ← empty deps: runs once on mount only, no infinite loops

  // ─── Listen for mid-session forced logout (apiClient refresh failure) ────────
  useEffect(() => {
    const handleAuthLogout = (event: Event) => {
      console.warn('[App] auth:logout event received — clearing session');
      clearMiniSession();
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message) setSessionError(message);
    };
    window.addEventListener('auth:logout', handleAuthLogout);
    return () => window.removeEventListener('auth:logout', handleAuthLogout);
  }, [clearMiniSession]);

  useEffect(() => {
    const handleDeviceContextChange = (event: Event) => {
      // Ignore our own synchronous context notification during session cleanup.
      if (clearingMiniSessionRef.current) return;
      const customEvent = event as CustomEvent<MiniDeviceContext | null>;
      const resolvedDeviceContext = normalizeMiniDeviceContext(customEvent.detail);
      setDeviceContext(resolvedDeviceContext);

      if (resolvedDeviceContext) {
        setSessionError(null);
        return;
      }

      if (!isBootstrapping && isLoggedIn) {
        clearMiniSession();
        setSessionError('تعذر التحقق من وضع هذا الجهاز. سجّل الدخول مرة أخرى.');
      }
    };

    window.addEventListener('mini:device-context', handleDeviceContextChange as EventListener);
    return () => window.removeEventListener('mini:device-context', handleDeviceContextChange as EventListener);
  }, [clearMiniSession, isBootstrapping, isLoggedIn]);

  const refreshStaff = useCallback(async () => {
    if (!cashier) {
      return;
    }

    try {
      // Fetch today's attendance instead of just employee list
      // This endpoint returns both employee details and their current status
      const response = await apiClient.get('/attendance/today');

      if (!response || !Array.isArray(response.employees)) {
        console.error("❌ Invalid attendance response:", response);
        return;
      }

      const mappedStaff: StaffMember[] = response.employees.map((e: any) => {
        const roleStr = String(e.type || '').toUpperCase();
        return {
          id: e.id,
          name: e.name,
          role: roleStr === 'BARBER' ? 'حلاق' : (roleStr === 'ASSISTANT' ? 'مساعد' : 'مساعد'),
          // isPresent is TRUE only if status is exactly 'PRESENT'
          isPresent: e.status === 'PRESENT',
          avatar: e.image_url ? (e.image_url.startsWith('http') ? e.image_url : `${BACKEND_URL}/uploads/${e.image_url.replace(/\\/g, '/')}`) : e.name ? e.name[0] : '?',
          phone: e.phone
        };
      });

      setStaff(mappedStaff);
    } catch (error) {
      console.error("Failed to fetch staff:", error);
      throw error;
    }
  }, [cashier]);

  // Fetch staff on startup with real attendance status
  useEffect(() => {
    if (!cashier) return;

    refreshStaff().catch(() => {
      // Preserve current startup behavior and error logging without crashing effects.
    });
  }, [cashier, refreshStaff]);

  const mapCustomerImageUrl = useCallback((imagePath: string) => {
    if (!imagePath) {
      return imagePath;
    }

    if (/^https?:\/\//i.test(imagePath)) {
      return imagePath;
    }

    const normalizedPath = imagePath.startsWith('/') ? imagePath : `/uploads/${imagePath}`;
    return `${BACKEND_URL}${normalizedPath}`;
  }, []);

  const mapCustomerFromApi = useCallback((customer: any, fallback?: Partial<Customer>): Customer => ({
    id: customer.id.toString(),
    name: customer.name,
    phone: customer.phone,
    images: (customer.images || []).map((img: string) => mapCustomerImageUrl(img)),
    visitCount: customer.visits_count ?? customer.visitCount ?? fallback?.visitCount ?? 0,
    lastBarber: customer.last_barber_name ?? customer.lastBarber ?? fallback?.lastBarber ?? '',
    lastVisitDate: customer.last_visit_at
      ? new Date(customer.last_visit_at).getTime()
      : customer.created_at
        ? new Date(customer.created_at).getTime()
        : fallback?.lastVisitDate ?? Date.now(),
    depositBalance: customer.deposit_balance ?? customer.depositBalance ?? fallback?.depositBalance ?? 0,
  }), [mapCustomerImageUrl]);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);


  // Fetch appointments from backend
  useEffect(() => {
    if (!cashier) return;

    const fetchAppointments = async () => {
      try {
        const data = await apiClient.get('/appointments');
        // Map backend response to frontend Appointment type
        const mappedAppointments: Appointment[] = [
          ...data.today.map((a: any) => ({
            id: a.id.toString(),
            customerId: a.customer_id, barberId: a.barber_id, serviceId: a.service_id, rawStatus: a.status,
            customerName: a.customer_name,
            phone: a.phone,
            service: a.service_name,
            barberName: a.barber_name || 'غير محدد',
            time: formatTimeToArabic(a.time),
            date: 'اليوم',
            status: 'قادم' as const,
            deposit: a.deposit > 0 ? a.deposit : undefined
          })),
          ...data.tomorrow.map((a: any) => ({
            id: a.id.toString(),
            customerId: a.customer_id, barberId: a.barber_id, serviceId: a.service_id, rawStatus: a.status,
            customerName: a.customer_name,
            phone: a.phone,
            service: a.service_name,
            barberName: a.barber_name || 'غير محدد',
            time: formatTimeToArabic(a.time),
            date: 'الغد',
            status: 'قادم' as const,
            deposit: a.deposit > 0 ? a.deposit : undefined
          })),
          ...data.future.map((a: any) => ({
            id: a.id.toString(),
            customerId: a.customer_id, barberId: a.barber_id, serviceId: a.service_id, rawStatus: a.status,
            customerName: a.customer_name,
            phone: a.phone,
            service: a.service_name,
            barberName: a.barber_name || 'غير محدد',
            time: formatTimeToArabic(a.time),
            date: a.date, // Use actual date from backend
            status: 'قادم' as const,
            deposit: a.deposit > 0 ? a.deposit : undefined
          }))
        ];
        setAppointments(mappedAppointments);
      } catch (error) {
        console.error("Failed to fetch appointments:", error);
      }
    };

    fetchAppointments();
  }, [cashier]);

  // Fetch expenses from backend
  useEffect(() => {
    if (!cashier) return;

    const fetchExpenses = async () => {
      try {
        const data = await apiClient.get('/expenses/today');
        // Map backend response to frontend Expense type
        const mappedExpenses: Expense[] = data.map((e: any) => ({
          id: e.id.toString(),
          type: e.category,
          amount: e.amount,
          notes: e.notes,
          date: e.expense_date,
          time: formatTimeToArabic(e.time),
          cashierName: e.cashier
        }));
        setExpenses(mappedExpenses);
      } catch (error) {
        console.error("Failed to fetch expenses:", error);
      }
    };

    fetchExpenses();
  }, [cashier]);

  const toggleStaffAttendance = useCallback(async (id: number) => {
    const member = staff.find(s => s.id === id);
    if (!member) return;

    try {
      const endpoint = member.isPresent ? '/attendance/check-out' : '/attendance/check-in';
      const response = await apiClient.post(endpoint, { employee_id: id });

      console.log(`✅ ${member.isPresent ? 'Check-out' : 'Check-in'} successful:`, response);

      // Status in backend: 'PRESENT', 'LEFT', 'ABSENT'
      setStaff(prev => prev.map(m =>
        m.id === id ? { ...m, isPresent: response.status === 'PRESENT' } : m
      ));
    } catch (error: any) {
      console.error("Attendance toggle failed:", error);
      alert(error.message || "فشل تحديث حالة الحضور. الرجاء المحاولة مرة أخرى.");
    }
  }, [staff]);

  const editCustomer = useCallback(async (id: string, data: FormData): Promise<Customer> => {
    try {
      const res = await apiClient.patch(`/customers/${id}`, data);
      return mapCustomerFromApi(res);
    } catch (error) {
      console.error("Failed to update customer:", error);
      throw error;
    }
  }, [mapCustomerFromApi]);

  const addNewCustomer = useCallback(async (formData: FormData): Promise<Customer> => {
    try {
      const newCustomer = await apiClient.post('/customers', formData);
      return mapCustomerFromApi(newCustomer);
    } catch (error) {
      console.error("Failed to add customer:", error);
      throw error;
    }
  }, [mapCustomerFromApi]);

  const handleDeleteCustomer = useCallback(async (id: string) => {
    try {
      await apiClient.delete(`/customers/${id}`);
    } catch (error) {
      console.error("Failed to delete customer:", error);
      alert("فشل حذف العميل. الرجاء المحاولة مرة أخرى.");
      throw error;
    }
  }, []);

  const addAppointment = useCallback(async (data: AppointmentFormData): Promise<AppointmentCreateResult | null> => {
    try {
      const time24 = convertArabicTimeTo24Hour(data.time);
      const isoDate = convertArabicDateToISO(data.date);
      const barber = staff.find(s => s.name === data.barberName);

      const payload = {
        customer_name: data.customerName,
        phone: data.phone,
        service_name: data.service,  // Free-text service name
        barber_id: barber?.id || null,
        date: isoDate,
        time: time24,
        deposit: data.deposit || 0,
        deposit_payment_method: data.deposit && data.deposit > 0 ? data.depositPaymentMethod : undefined
      };

      console.log("🚀 Creating appointment with payload:", payload);
      const response = await apiClient.post('/appointments', payload);
      console.log("✅ Appointment created successfully:", response);

      // Add to local state with proper date formatting
      const newApp: Appointment = {
        id: response.id.toString(),
        customerId: response.customer_id, barberId: response.barber_id, serviceId: response.service_id, rawStatus: response.status,
        customerName: response.customer_name,
        phone: response.phone,
        service: response.service_name,
        barberName: response.barber_name || 'غير محدد',
        time: formatTimeToArabic(response.time),
        date: formatISODateToArabic(response.date),  // Convert ISO to Arabic format
        status: 'قادم',
        deposit: response.deposit > 0 ? response.deposit : undefined
      };
      setAppointments(prev => [newApp, ...prev]);
      return {
        appointment: newApp,
        depositTransaction: response.deposit_transaction,
      };
    } catch (error) {
      console.error("Failed to create appointment:", error);
      alert(error instanceof Error ? error.message : "فشل في إنشاء الموعد. الرجاء المحاولة مرة أخرى.");
      return null;
    }
  }, [staff]);

  const deleteAppointment = useCallback(async (id: string) => {
    try {
      await apiClient.delete(`/appointments/${id}`);
      setAppointments(prev => prev.filter(app => app.id !== id));
    } catch (error) {
      console.error("Failed to delete appointment:", error);
      alert(error instanceof Error ? error.message : "فشل في حذف الموعد. الرجاء المحاولة مرة أخرى.");
    }
  }, []);

  // Helper function to convert Arabic time to 24-hour format
  const convertArabicTimeTo24Hour = (arabicTime: string): string => {
    const [time, period] = arabicTime.split(' ');
    const [hours, minutes] = time.split(':');
    let hour = parseInt(hours);

    if (period === 'م' && hour !== 12) {
      hour += 12;
    } else if (period === 'ص' && hour === 12) {
      hour = 0;
    }

    return `${hour.toString().padStart(2, '0')}:${minutes}`;
  };

  // Helper function to convert Arabic date to ISO format
  const convertArabicDateToISO = (dateString: string): string => {
    console.log("🔍 convertArabicDateToISO input:", dateString);

    // If already in ISO format (YYYY-MM-DD), return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      console.log("✅ Already ISO format, returning:", dateString);
      return dateString;
    }

    // Handle Arabic text dates
    const today = getCairoNow();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (dateString === 'اليوم' || dateString.includes('اليوم')) {
      const result = getTodayISO();
      console.log("✅ Converted 'اليوم' to:", result);
      return result;
    } else if (dateString === 'الغد' || dateString.includes('الغد')) {
      const result = tomorrow.toISOString().split('T')[0];
      console.log("✅ Converted 'الغد' to:", result);
      return result;
    }

    // Fallback - should never reach here with new implementation
    console.error("❌ Unexpected date format:", dateString, "- falling back to today");
    return getTodayISO();
  };

  // Helper function to format 24-hour time to Arabic
  const formatTimeToArabic = (time24: string): string => {
    const [hours, minutes] = time24.split(':');
    let hour = parseInt(hours);
    const period = hour >= 12 ? 'م' : 'ص';

    if (hour > 12) {
      hour -= 12;
    } else if (hour === 0) {
      hour = 12;
    }

    return `${hour.toString().padStart(2, '0')}:${minutes} ${period}`;
  };

  // Helper function to convert ISO date to Arabic format (اليوم/الغد/date)
  const formatISODateToArabic = (isoDate: string): string => {
    // Parse the ISO date string (YYYY-MM-DD)
    const [year, month, day] = isoDate.split('-').map(Number);
    const appointmentDate = new Date(year, month - 1, day);

    const today = getCairoNow();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const tomorrow = new Date(todayDate);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (appointmentDate.getTime() === todayDate.getTime()) {
      return 'اليوم';
    } else if (appointmentDate.getTime() === tomorrow.getTime()) {
      return 'الغد';
    } else {
      const result = `${day}/${month}`;
      return result;
    }
  };

  const addExpense = useCallback(async (data: Omit<Expense, 'id'>) => {
    try {
      const payload = {
        expense_category_id: data.categoryId,
        amount: data.amount,
        notes: data.notes,
        expense_date: data.date
      };

      const response = await apiClient.post('/expenses', payload);

      const newExpense = {
        id: response.id.toString(),
        customerId: response.customer_id, barberId: response.barber_id, serviceId: response.service_id, rawStatus: response.status,
        type: response.category,
        amount: response.amount,
        notes: response.notes,
        date: response.expense_date,
        time: formatTimeToArabic(response.time),
        cashierName: response.cashier
      };
      setExpenses(prev => [newExpense, ...prev]);
    } catch (error) {
      console.error("Failed to create expense:", error);
      alert("فشل في إنشاء المصروف. الرجاء المحاولة مرة أخرى.");
    }
  }, []);


  const handleLoginSuccess = (data: { cashier: Cashier, token?: string, access_token?: string, refresh_token?: string, device_context?: MiniDeviceContext | null }) => {
    const accessToken = data.access_token || data.token;
    const resolvedDeviceContext = normalizeMiniDeviceContext(data.device_context);

    if (!accessToken || !resolvedDeviceContext) {
      clearMiniSession();
      setSessionError('تم تسجيل الدخول لكن لم تصل صلاحية الجهاز بشكل صحيح. أعد المحاولة.');
      return;
    }

    localStorage.setItem('mini_cashier', JSON.stringify(data.cashier));
    localStorage.setItem('mini_token', accessToken);
    if (data.refresh_token) {
      localStorage.setItem('mini_refresh_token', data.refresh_token);
    }
    setStoredDeviceContext(resolvedDeviceContext);
    setCashier(data.cashier);
    setDeviceContext(resolvedDeviceContext);
    setSessionError(null);
    setIsLoggedIn(true);
    setIsMiniSidebarOpen(false);
  };

  const handleLogout = useCallback(() => {
    clearMiniSession();
    setSessionError(null);
  }, [clearMiniSession]);

  const renderContent = () => {
    const presentBarbers = staff.filter(s => s.role === 'حلاق' && s.isPresent);
    const presentAssistants = staff.filter(s => s.role === 'مساعد' && s.isPresent);

    switch (activePage) {
      case 'الانتظار':
        return <WaitingScreen cashier={cashier!} />;
      case 'الكاشير':
        return null; // The single Cashier instance remains mounted below.
      case 'العملاء':
        return <CustomersScreen
          onEdit={editCustomer}
          onAdd={addNewCustomer}
          onDelete={handleDeleteCustomer}
          staff={staff}
        />;
      case 'الحلاقين':
        return <BarbersScreen
          staff={staff}
          onAddExpense={addExpense}
          onBarberAction={async (barberId, action) => {
            try {
              await apiClient.post(`/barbers/${barberId}/financial-action`, action);
              // Refresh expenses to show the new record immediately
              const expData = await apiClient.get('/expenses/today');
              const mappedExpenses: Expense[] = expData.map((e: any) => ({
                id: e.id,
                type: e.category,
                amount: e.amount,
                notes: e.notes,
                date: e.expense_date,
                time: e.time,
                cashierName: e.cashier
              }));
              setExpenses(mappedExpenses);
            } catch (error) {
              console.error("Barber Action Failed:", error);
              throw error; // Let component handle UI feedback
            }
          }}
          currentCashier={cashier?.name || ''}
        />;
      case 'الخزينة':
        return <MiniTreasuryPage onBusinessDayClosed={refreshStaff} />;
      case 'المواعيد القادمة':
        return <AppointmentsScreen
          appointments={appointments}
          onAddAppointment={addAppointment}
          onDeleteAppointment={deleteAppointment}
          onReadyForCashier={requestBookingHandoff}
          handoffPendingId={bookingHandoff?.appointmentId ?? null}
          handoffFeedback={handoffFeedback}
          staff={staff}
          cashier={cashier}
        />;
      case 'المصروفات':
        return <ExpensesScreen
          expenses={expenses}
          onAddExpense={addExpense}
          cashier={cashier!}
        />;

      case 'المخزن':
        return <StorageScreen cashier={cashier!} />;
      case 'الحضور والانصراف':
        return <AttendanceScreen staff={staff} onToggleAttendance={toggleStaffAttendance} cashier={cashier} />;
      default:
        return <PagePlaceholder title={activePage as string} />;
    }
  };

  // While validating stored token, show a minimal loading screen.
  // This prevents the login screen from flashing on every page refresh.
  if (isBootstrapping) {
    return (
      <div className="mini-shell flex items-center justify-center bg-[#121212]" dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-[3px] border-white/10 border-t-[#E6D690] rounded-full animate-spin" />
          <p className="text-[#BDBDBD]/40 text-sm font-['Cairo']">جاري التحقق...</p>
        </div>
      </div>
    );
  }

  if (!isLoggedIn || !cashier) {
    return <LoginScreen onLogin={handleLoginSuccess} externalError={sessionError} />;
  }

  if (!deviceContext) {
    return (
      <div className="mini-shell flex items-center justify-center bg-[#121212]" dir="rtl">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <div className="w-8 h-8 border-[3px] border-white/10 border-t-[#E53935] rounded-full animate-spin" />
          <p className="text-[#BDBDBD]/55 text-sm font-['Cairo']">جارٍ التحقق من صلاحية الجهاز...</p>
        </div>
      </div>
    );
  }

  if (deviceContext.access_mode === 'INVENTORY_ONLY') {
    return (
      <InventoryOnlyApp
        cashier={cashier}
        deviceContext={deviceContext}
        onLogout={handleLogout}
      />
    );
  }

  if (deviceContext.access_mode !== 'FULL_MINI') {
    return (
      <div className="mini-shell flex items-center justify-center bg-[#121212]" dir="rtl">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-[2rem] border border-white/5 bg-[#191919] px-6 py-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#E53935]/10 text-[#E53935] flex items-center justify-center">!</div>
          <p className="text-white font-bold">تعذر تحديد وضع هذا الجهاز بأمان.</p>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-2xl bg-[#E53935] px-5 py-3 text-sm font-bold text-white"
          >
            العودة لتسجيل الدخول
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mini-shell relative isolate flex bg-[#121212] text-[#F5F5F5] selection:bg-[#E6D690] selection:text-[#121212] transition-colors duration-500" dir="rtl">
      {isMiniSidebarOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة الجانبية"
          className="mini-sidebar-backdrop"
          onClick={() => setIsMiniSidebarOpen(false)}
        />
      )}
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        onLogout={handleLogout}
        isOpen={isMiniSidebarOpen}
        onToggle={() => setIsMiniSidebarOpen(prev => !prev)}
      />
      <div className="mini-shell-page relative z-0 min-w-0 flex-1 transition-all duration-300 ease-in-out">
        {cashier && <div hidden={activePage !== 'الكاشير'} className="h-full min-h-0">
          <CashierScreen key={`${cashier.branch_id}:${cashier.id}:${cashier.email}`}
            isActive={activePage === 'الكاشير'} sidebarOpen={isMiniSidebarOpen} deviceContext={deviceContext}
            presentBarbers={staff.filter(s => s.role === 'حلاق' && s.isPresent)}
            presentAssistants={staff.filter(s => s.role === 'مساعد' && s.isPresent)}
            adminSettings={getEffectiveSettings(cashier)} appointments={appointments} cashier={cashier}
            handoffRequest={bookingHandoff} onHandoffResult={completeBookingHandoff} />
        </div>}
        {renderContent()}
      </div>
    </div>
  );
};

export default App;
